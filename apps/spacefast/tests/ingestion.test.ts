import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DetailedPeerCertificate } from 'node:tls';
import { createWorkerApi, fitResultToBudget, MAX_RESULT_BYTES, readConfig, runOnce, type Claim, type WorkerApi } from '../worker/index.js';
import { parseFeed, toPlainText } from '../worker/parse-feed.js';
import {
  fetchFeed, isPublicAddress, pinnedRequestOptions, validateFeedUrl, MAX_FEED_BYTES,
  type PinnedRequest, type PinnedTransport, type Resolver, type ResponseHeaders, type TransportResponse,
} from '../worker/safe-fetch.js';
import type { WorkerResult } from '../shared/contracts.js';

const publicResolver: Resolver = async () => [{ address: '93.184.216.34', family: 4 }];
const rss = (items: string) => `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Test</title>${items}</channel></rss>`;
const item = '<item><guid>abc</guid><title>One</title><link>https://example.com/posts/one</link><description>Hello</description></item>';
function response(status = 200, body = rss(item), headers: ResponseHeaders = {}): TransportResponse & { disposed: boolean } {
  const result = {
    status, headers, disposed: false,
    body: (async function* () { yield Buffer.from(body); })(),
    dispose() { result.disposed = true; },
  };
  return result;
}
function transportSequence(responses: TransportResponse[], calls: PinnedRequest[] = []): PinnedTransport {
  return async request => {
    calls.push(request);
    const next = responses.shift();
    assert.ok(next, 'Unexpected transport call');
    return next;
  };
}
const rejectsWith = (promise: Promise<unknown>, code: string) => assert.rejects(promise, { message: code });

test('feed URL validation rejects literal/private/credential and parser-confusion variants', () => {
  for (const url of [
    'http://example.com/feed', 'file:///etc/passwd', 'https://127.0.0.1/', 'https://2130706433/',
    'https://0x7f000001/', 'https://0177.0.0.1/', 'https://[::1]/', 'https://[::ffff:127.0.0.1]/',
    'https://169.254.169.254/', 'https://user:secret@example.com/', 'https://example.com:444/',
    'https://localhost/', 'https://metadata.google.internal/', 'https://foo.local/',
    'https://example.com./', 'https://no-dot/', 'https://example.com\\@evil.com/',
    'https://example.com/\nfeed', 'https://a..example.com/', 'https://bad_.example.com/',
  ]) assert.throws(() => validateFeedUrl(url), { name: 'IngestionError' }, url);
  assert.equal(validateFeedUrl('https://example.com:443/feed#fragment').href, 'https://example.com/feed');
  assert.equal(validateFeedUrl('https://bücher.de/feed').hostname, 'xn--bcher-kva.de');
});

test('public address checks reject every nonpublic, reserved and transition family', () => {
  const blocked = [
    '0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.16.1.1',
    '192.168.1.1', '192.0.0.1', '192.0.2.1', '192.88.99.1', '198.18.0.1', '198.51.100.1',
    '203.0.113.1', '168.63.129.16', '224.0.0.1', '240.0.0.1', '255.255.255.255', '::', '::1', 'fc00::1', 'fe80::1',
    'ff02::1', '::ffff:8.8.8.8', '::ffff:127.0.0.1', '64:ff9b::808:808', '2001:db8::1',
    '2002:0808:0808::1', '2001::1', '3fff::1', '5f00::1', '4000::1', 'fe80::1%eth0', 'bogus',
  ];
  for (const address of blocked) assert.equal(isPublicAddress(address), false, address);
  for (const address of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888']) {
    assert.equal(isPublicAddress(address), true, address);
  }
});

test('all DNS answers must be public and family-correct before any request', async () => {
  let called = false;
  const transport: PinnedTransport = async () => { called = true; return response(); };
  for (const records of [
    [], [{ address: '10.0.0.1', family: 4 as const }],
    [{ address: '8.8.8.8', family: 4 as const }, { address: '::1', family: 6 as const }],
    [{ address: '8.8.8.8', family: 6 as const }],
  ]) await rejectsWith(fetchFeed('https://example.com/feed', { resolver: async () => records, transport }), 'UNSAFE_ADDRESS');
  assert.equal(called, false);
});

test('fetch pins a checked IP and sends only safe validators, no credentials', async () => {
  const calls: PinnedRequest[] = [];
  const result = await fetchFeed('https://example.com/feed', {
    resolver: publicResolver, transport: transportSequence([response(200, rss(item), { etag: '"new"' })], calls),
    etag: '"old"', lastModified: 'Sat, 24 Oct 2026 00:00:00 GMT',
  });
  assert.equal(result.status, 'success');
  assert.equal(result.etag, '"new"');
  assert.deepEqual(calls[0]?.address, { address: '93.184.216.34', family: 4 });
  assert.equal(calls[0]?.headers['if-none-match'], '"old"');
  assert.equal(calls[0]?.headers['if-modified-since'], 'Sat, 24 Oct 2026 00:00:00 GMT');
  assert.equal(calls[0]?.headers['accept-encoding'], 'identity');
  assert.equal(calls[0]?.headers.authorization, undefined);
  assert.equal(calls[0]?.headers.cookie, undefined);
});

test('production transport pins lookup while retaining TLS hostname/certificate checks', () => {
  const options = pinnedRequestOptions({
    url: new URL('https://example.com/feed?q=1'), address: { address: '93.184.216.34', family: 4 },
    method: 'GET', headers: {}, signal: new AbortController().signal,
  });
  assert.equal(options.agent, false, 'No pooled connection can bypass a fresh pin');
  assert.equal(options.autoSelectFamily, false);
  assert.equal(options.family, 4);
  assert.equal(options.servername, 'example.com');
  assert.equal(options.hostname, 'example.com');
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.path, '/feed?q=1');
  let called = false;
  options.lookup!('example.com', {}, (error, address, family) => {
    called = true;
    assert.equal(error, null);
    assert.equal(address, '93.184.216.34');
    assert.equal(family, 4);
  });
  assert.equal(called, true);
  const wrong = { subjectaltname: 'DNS:evil.example.com' } as DetailedPeerCertificate;
  const correct = { subjectaltname: 'DNS:example.com' } as DetailedPeerCertificate;
  assert.ok(options.checkServerIdentity!('evil.example.com', wrong), 'Caller-supplied hostname cannot replace the intended hostname');
  assert.equal(options.checkServerIdentity!('example.com', correct), undefined);
});

test('header injection is dropped; 304 avoids reading or parsing a body', async () => {
  const calls: PinnedRequest[] = [];
  const result = await fetchFeed('https://example.com/feed', {
    resolver: publicResolver, transport: transportSequence([response(304, 'not XML', { etag: 'bad\r\nvalue' })], calls),
    etag: 'bad\r\nAuthorization: secret', lastModified: 'Sat, 24 Oct 2026 00:00:00 GMT',
  });
  assert.equal(result.status, 'not_modified');
  assert.equal(result.body.length, 0);
  assert.equal(result.etag, undefined);
  assert.equal(calls[0]?.headers['if-none-match'], undefined);
  assert.equal(calls[0]?.headers['if-modified-since'], 'Sat, 24 Oct 2026 00:00:00 GMT');
});

test('unsolicited not-modified and excessively long Last-Modified cannot mark a first fetch successful', async () => {
  const calls: PinnedRequest[] = [];
  await rejectsWith(fetchFeed('https://example.com/feed', {
    resolver: publicResolver, transport: transportSequence([response(304)], calls), lastModified: 'x'.repeat(201),
  }), 'UNEXPECTED_NOT_MODIFIED');
  assert.equal(calls[0]?.headers['if-modified-since'], undefined);
});

test('redirects resolve and pin again, removing cross-origin validators', async () => {
  const hosts: string[] = [];
  const calls: PinnedRequest[] = [];
  const first = response(302, '', { location: 'https://other.example.com/feed' });
  await fetchFeed('https://example.com/feed', {
    resolver: async hostname => { hosts.push(hostname); return publicResolver(hostname); },
    transport: transportSequence([first, response()], calls), etag: '"old"',
  });
  assert.deepEqual(hosts, ['example.com', 'other.example.com']);
  assert.equal(calls[1]?.headers['if-none-match'], undefined);
  assert.equal(first.disposed, true);
});

test('redirects cannot reach private DNS, credentials, HTTP or metadata literals', async () => {
  for (const location of ['https://127.0.0.1/', 'http://example.com/', 'https://u:p@example.com/', 'https://169.254.169.254/']) {
    await rejectsWith(fetchFeed('https://example.com/feed', {
      resolver: publicResolver, transport: transportSequence([response(302, '', { location })]),
    }), 'UNSAFE_REDIRECT');
  }
  let requests = 0;
  await rejectsWith(fetchFeed('https://example.com/feed', {
    resolver: async hostname => [{ address: hostname === 'example.com' ? '8.8.8.8' : '10.0.0.1', family: 4 }],
    transport: async () => { requests++; return response(302, '', { location: 'https://other.example.com/' }); },
  }), 'UNSAFE_ADDRESS');
  assert.equal(requests, 1);
});

test('same-origin redirect rechecks DNS, defeating rebinding between connections', async () => {
  let resolutions = 0;
  const calls: PinnedRequest[] = [];
  await rejectsWith(fetchFeed('https://example.com/feed', {
    resolver: async () => [{ address: ++resolutions === 1 ? '8.8.8.8' : '127.0.0.1', family: 4 }],
    transport: transportSequence([response(302, '', { location: '/next' })], calls),
  }), 'UNSAFE_ADDRESS');
  assert.equal(calls.length, 1);
});

test('three redirects maximum and every discarded response is disposed', async () => {
  const responses = Array.from({ length: 4 }, () => response(302, '', { location: '/again' }));
  const copies = [...responses];
  await rejectsWith(fetchFeed('https://example.com/feed', {
    resolver: publicResolver, transport: transportSequence(responses),
  }), 'TOO_MANY_REDIRECTS');
  assert.ok(copies.every(result => result.disposed));
});

test('content length, streaming bytes and compressed responses are bounded/rejected', async () => {
  for (const [result, code] of [
    [response(200, '', { 'content-length': String(MAX_FEED_BYTES + 1) }), 'BODY_TOO_LARGE'],
    [response(200, 'x'.repeat(MAX_FEED_BYTES + 1)), 'BODY_TOO_LARGE'],
    [response(200, 'gzip bomb', { 'content-encoding': 'gzip' }), 'UNSUPPORTED_ENCODING'],
    [response(500, '<html>failure</html>'), 'UPSTREAM_STATUS'],
  ] as const) {
    await rejectsWith(fetchFeed('https://example.com/feed', { resolver: publicResolver, transport: transportSequence([result]) }), code);
    assert.equal(result.disposed, true);
  }
});

test('total timeout covers DNS, transport and a stalled response stream', async () => {
  await rejectsWith(fetchFeed('https://example.com/feed', {
    timeoutMs: 10, resolver: () => new Promise(() => {}),
  }), 'FETCH_TIMEOUT');
  await rejectsWith(fetchFeed('https://example.com/feed', {
    timeoutMs: 10, resolver: publicResolver, transport: () => new Promise(() => {}),
  }), 'FETCH_TIMEOUT');
  const stalled = response();
  stalled.body = (async function* () { await new Promise(() => {}); yield Buffer.alloc(0); })();
  await rejectsWith(fetchFeed('https://example.com/feed', {
    timeoutMs: 10, resolver: publicResolver, transport: transportSequence([stalled]),
  }), 'FETCH_TIMEOUT');
  assert.equal(stalled.disposed, true);
});

test('RSS parsing produces plaintext, normalized metadata and source-scoped stable keys', () => {
  const xml = rss(`<item><guid isPermaLink="false">abc</guid><title>A &amp; B</title><link>https://example.com/post?a=1&amp;b=2</link><dc:creator xmlns:dc="urn:dc">Writer</dc:creator><pubDate>Sat, 24 Oct 2026 10:00:00 GMT</pubDate><content:encoded xmlns:content="urn:content"><![CDATA[<p>Hello <b>reader</b>.</p><script>alert(1)</script><img src="https://track.example.com/pixel"><p>Next &amp; last.</p>]]></content:encoded></item>`);
  const [article] = parseFeed(xml, 'source1', 'https://example.com/feed');
  assert.ok(article);
  assert.equal(article.title, 'A & B');
  assert.equal(article.url, 'https://example.com/post?a=1&b=2');
  assert.equal(article.author, 'Writer');
  assert.equal(article.publishedAt, '2026-10-24T10:00:00.000Z');
  assert.equal(article.bodyText, 'Hello reader.\n\nNext & last.');
  assert.match(article.key, /^item_[a-f0-9]{64}$/);
  assert.equal(parseFeed(xml.replace('Hello', 'Changed'), 'source1', 'https://example.com/feed')[0]?.key, article.key);
  assert.notEqual(parseFeed(xml, 'source2', 'https://example.com/feed')[0]?.key, article.key);
});

test('Atom parsing handles alternate links, author names, namespaces and XHTML order', () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>urn:one</id><title type="html">&lt;b&gt;Atom title&lt;/b&gt;</title><link rel="self" href="https://example.com/self"/><link rel="alternate" href="/article"/><author><name>Alice</name><uri>https://example.com/alice</uri></author><updated>2026-10-24T12:00:00Z</updated><content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Hello <b>bold</b> text.</p><script>bad()</script><p>Second.</p></div></content></entry></feed>`;
  const [article] = parseFeed(xml, 'atom', 'https://example.com/feeds/all');
  assert.equal(article?.title, 'Atom title');
  assert.equal(article?.url, 'https://example.com/article');
  assert.equal(article?.author, 'Alice');
  assert.equal(article?.publishedAt, '2026-10-24T12:00:00.000Z');
  assert.equal(article?.bodyText, 'Hello bold text.\n\nSecond.');
});

test('RSS 1/RDF and namespaced Atom roots are supported', () => {
  const rdf = '<rdf:RDF xmlns:rdf="urn:rdf"><channel/><item rdf:about="https://example.com/one"><title>RDF</title></item></rdf:RDF>';
  assert.equal(parseFeed(rdf, 'source', 'https://example.com/')[0]?.title, 'RDF');
  assert.equal(parseFeed('<atom:feed xmlns:atom="urn:atom"><atom:entry><atom:id>one</atom:id></atom:entry></atom:feed>', 'source', 'https://example.com/')[0]?.title, 'Untitled article');
});

test('DTD, external entities and expansion attacks fail closed before parsing', () => {
  for (const xml of [
    '<!DOCTYPE rss SYSTEM "file:///etc/passwd">' + rss(item),
    '<!DOCTYPE rss [<!ENTITY xxe SYSTEM "https://internal/secret">]>' + rss('<item><title>&xxe;</title></item>'),
    '<!DOCTYPE rss [<!ENTITY a "123"><!ENTITY b "&a;&a;">]>' + rss('<item><title>&b;</title></item>'),
    '<!ENTITY attack "abc">' + rss(item),
  ]) assert.throws(() => parseFeed(xml, 'source', 'https://example.com/'), { message: 'FORBIDDEN_XML_DECLARATION' });
});

test('malformed, oversized, excessively deep and unsupported XML is rejected', () => {
  for (const xml of ['<rss><channel></rss>', '<rss/>', '<html><body>not a feed</body></html>', '', '<rss>\u0000</rss>']) {
    assert.throws(() => parseFeed(xml, 'source', 'https://example.com/'));
  }
  assert.throws(() => parseFeed('x'.repeat(MAX_FEED_BYTES + 1), 'source', 'https://example.com/'), { message: 'BODY_TOO_LARGE' });
  assert.throws(() => parseFeed(rss('<item>' + '<nested>'.repeat(40) + 'x' + '</nested>'.repeat(40) + '</item>'), 'source', 'https://example.com/'));
  assert.throws(() => parseFeed('<?xml version="1.0" encoding="UTF-16"?><rss><channel/></rss>', 'source', 'https://example.com/'), { message: 'UNSUPPORTED_XML_ENCODING' });
  assert.throws(() => parseFeed(Buffer.from([0xff, 0xfe, 0x00]), 'source', 'https://example.com/'), { message: 'UNSUPPORTED_XML_ENCODING' });
});

test('article text never retains executable HTML or tracking images', () => {
  const dirty = '<p>Visible &copy; &amp; words</p><img src=x onerror=alert(1)><script>secret()</script><style>bad</style><iframe src=x>hidden</iframe><svg><script>evil</script></svg><object>hidden</object><a href="javascript:alert(1)">Link text</a>';
  assert.equal(toPlainText(dirty), 'Visible © & words\nLink text');
  assert.equal(toPlainText('plain < text & more'), 'plain < text & more');
});

test('entry count, field sizes and duplicate GUIDs are bounded', () => {
  const xml = rss(Array.from({ length: 70 }, (_, i) => `<item><guid>${i}</guid><title>${'t'.repeat(600)}</title><author>${'a'.repeat(300)}</author><description>${i === 0 ? 'b'.repeat(60_000) : 'short'}</description></item>`).join(''));
  const items = parseFeed(xml, 'source', 'https://example.com/');
  assert.equal(items.length, 50);
  assert.equal(items[0]?.title.length, 500);
  assert.equal(items[0]?.author.length, 200);
  assert.equal(items[0]?.bodyText.length, 50_000);
  assert.equal(parseFeed(rss(item + item), 'source', 'https://example.com/').length, 1);
});

test('fallback identities are stable and missing/unsafe metadata is empty', () => {
  for (const link of ['javascript:alert(1)', 'data:text/html,evil', 'http://example.com/', 'https://user:pass@example.com/', 'https://127.0.0.1/']) {
    const [article] = parseFeed(rss(`<item><title>One</title><link>${link}</link><pubDate>no date</pubDate></item>`), 'source', 'https://example.com/');
    assert.equal(article?.url, '');
    assert.equal(article?.author, '');
    assert.equal(article?.publishedAt, '');
  }
  const noGuid = item.replace('<guid>abc</guid>', '');
  assert.equal(parseFeed(rss(noGuid), 's', 'https://example.com/')[0]?.key, parseFeed(rss(noGuid.replace('Hello', 'Changed')), 's', 'https://example.com/')[0]?.key);
});

const secret = 'unit-test-only-not-a-real-secret-123456';
test('production worker configuration has no HTTP/loopback or path escape hatch', () => {
  for (const appUrl of ['http://localhost:3000', 'https://127.0.0.1/', 'https://example.com/other', 'https://example.com/?x=1', 'https://u:p@example.com/', 'https://example.com/#x']) {
    assert.throws(() => readConfig({ FEEDS_APP_URL: appUrl, FEEDS_WORKER_SECRET: secret }));
  }
  assert.throws(() => readConfig({ FEEDS_APP_URL: 'https://example.com', FEEDS_WORKER_SECRET: 'short' }));
  assert.deepEqual(readConfig({ FEEDS_APP_URL: 'https://example.com/', FEEDS_WORKER_SECRET: secret }), { appUrl: 'https://example.com', secret });
});

test('API auth is only sent to fixed routes; redirects are not followed', async () => {
  const calls: PinnedRequest[] = [];
  const api = createWorkerApi({ appUrl: 'https://example.com/', secret }, {
    resolver: publicResolver,
    transport: transportSequence([response(302, '', { location: 'https://evil.example.com/' })], calls),
  });
  await rejectsWith(api.claim(), 'WORKER_API_STATUS');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url.href, 'https://example.com/api/worker/claim');
  assert.equal(calls[0]?.headers.authorization, `Bearer ${secret}`);
  assert.equal(calls[0]?.method, 'POST');
});

test('claim JSON is bounded and validated', async () => {
  for (const [body, code] of [['{}', 'INVALID_CLAIM'], ['{"jobId":12}', 'INVALID_CLAIM'], ['oops', 'WORKER_API_RESPONSE'], ['', 'INVALID_CLAIM'], ['x'.repeat(65_537), 'BODY_TOO_LARGE']]) {
    const api = createWorkerApi({ appUrl: 'https://example.com/', secret }, {
      resolver: publicResolver, transport: transportSequence([response(200, body)]),
    });
    await rejectsWith(api.claim(), code!);
  }
  const api = createWorkerApi({ appUrl: 'https://example.com/', secret }, {
    resolver: publicResolver, transport: transportSequence([response(200, 'null')]),
  });
  assert.equal(await api.claim(), null);
});

const claim: Claim = { jobId: 'job', leaseToken: 'lease', sourceId: 'source', url: 'https://example.com/feed', etag: '"old"' };
function fakeApi(value: Claim | null = claim) {
  const submitted: WorkerResult[] = [];
  const api: WorkerApi = { claim: async () => value, result: async result => { submitted.push(result); } };
  return { api, submitted };
}

test('worker submits success/not-modified/failure using the exact lease and no network credentials', async () => {
  for (const [upstream, status] of [[response(), 'success'], [response(304), 'not_modified'], [response(500), 'failure']] as const) {
    const { api, submitted } = fakeApi();
    const calls: PinnedRequest[] = [];
    assert.equal(await runOnce(api, { resolver: publicResolver, transport: transportSequence([upstream], calls) }), status);
    assert.equal(submitted[0]?.jobId, claim.jobId);
    assert.equal(submitted[0]?.leaseToken, claim.leaseToken);
    assert.equal(submitted[0]?.status, status);
    assert.equal(calls[0]?.headers.authorization, undefined);
    assert.equal(submitted[0]?.items?.length, status === 'success' ? 1 : 0);
  }
});

test('idle does not fetch; feed failures submit safe codes rather than exception details', async () => {
  const idle = fakeApi(null);
  assert.equal(await runOnce(idle.api), 'idle');
  assert.equal(idle.submitted.length, 0);
  const failed = fakeApi();
  assert.equal(await runOnce(failed.api, {
    resolver: publicResolver, transport: async () => { throw new Error(`sensitive ${secret}`); },
  }), 'failure');
  assert.equal(failed.submitted[0]?.error, 'FETCH_FAILED');
  assert.equal(JSON.stringify(failed.submitted).includes(secret), false);
});

test('result submission failure remains failed, without duplicate result or job claim retry', async () => {
  let claims = 0;
  let results = 0;
  const api: WorkerApi = {
    claim: async () => { claims++; return claim; },
    result: async () => { results++; throw new Error('network failed'); },
  };
  await assert.rejects(runOnce(api, { resolver: publicResolver, transport: transportSequence([response()]) }), /network failed/);
  assert.equal(claims, 1);
  assert.equal(results, 1);
});

test('whole-result wire budget preserves identities with bounded multibyte and JSON-escaped excerpts', () => {
  const result: WorkerResult = {
    jobId: 'job', leaseToken: 'lease', status: 'success', etag: 'x'.repeat(1024),
    items: Array.from({ length: 50 }, (_, index) => ({
      key: `item_${index}`, title: 'Long article', author: '', publishedAt: '',
      url: `https://example.com/${index}`, bodyText: ('😀"\\\n').repeat(10_000),
    })),
  };
  const bounded = fitResultToBudget(result);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) > MAX_RESULT_BYTES);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded)) <= MAX_RESULT_BYTES);
  assert.equal(bounded.items?.length, 50);
  assert.deepEqual(bounded.items?.map(item => item.key), result.items?.map(item => item.key));
  assert.ok(bounded.items?.every(item => item.bodyText.length > 0 && !/[\uD800-\uDBFF]$/.test(item.bodyText)));
  assert.equal(result.items?.[0]?.bodyText.length, 50_000, 'The original result is not mutated');
});
