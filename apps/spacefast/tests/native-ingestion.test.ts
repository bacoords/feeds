import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './harness.js';
import { addSource, dashboard, setArticleState, workerConfigured, refreshSource } from '../server/domain.js';
import { authenticateNativeTrigger, nativeTick } from '../server/native-ingestion.js';
import { decodeNativeUtf8, fetchNativeFeed, nativeFeedUrl, NATIVE_BODY_LIMIT, readNativeBody, type NativeResponse, type NativeTransport } from '../server/native-fetch.js';
const RSS = '<rss><channel><item><guid>one</guid><title>First</title><description><![CDATA[<p>Safe <b>text</b></p><script>no</script>]]></description></item></channel></rss>';
function response(text = RSS, status = 200, headers: Record<string, string> = {}, chunks?: Uint8Array[]): NativeResponse {
  const parts = [...(chunks ?? [new TextEncoder().encode(text)])];
  return { status, headers: new Headers(headers), body: { getReader: () => ({ read: async () => parts.length ? { done: false, value: parts.shift()! } : { done: true }, cancel: async () => {} }) } };
}
function setup() {
  const h = harness(); const ctx = h.context();
  ctx.env = {};
  return { h, ctx };
}
test('native URL policy rejects literals, private names, credentials and parser-confusion forms', () => {
  for (const url of ['http://example.org/rss', 'https://127.0.0.1/rss', 'https://[::1]/rss', 'https://2130706433/rss', 'https://0x7f.1/rss', 'https://metadata.google.internal/rss', 'https://user:pass@example.org/rss', 'https://example.org:8443/rss', 'https://example.org\\@localhost/rss', 'https://example.org./rss']) assert.throws(() => nativeFeedUrl(url), /UNSAFE_URL/, url);
  assert.equal(nativeFeedUrl('https://example.org/rss#fragment').href, 'https://example.org/rss');
});
test('strict portable UTF-8 decoder accepts multibyte text and rejects invalid sequences', () => {
  assert.equal(decodeNativeUtf8(new TextEncoder().encode('Hello 😀 café 中文')), 'Hello 😀 café 中文');
  for (const bytes of [[0xc0, 0x80], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xe2, 0x82], [0xff]]) assert.throws(() => decodeNativeUtf8(Uint8Array.from(bytes)), /INVALID_UTF8/);
});
test('native reads bound streamed bytes and reject missing streaming, encoding and framing', async () => {
  await assert.rejects(readNativeBody({ status: 200, headers: new Headers() }), /BOUNDED_READ_UNAVAILABLE/);
  await assert.rejects(readNativeBody(response('', 200, { 'content-length': String(NATIVE_BODY_LIMIT + 1) })), /BODY_TOO_LARGE/);
  await assert.rejects(readNativeBody(response('', 200, {}, [new Uint8Array(NATIVE_BODY_LIMIT), new Uint8Array(1)])), /BODY_TOO_LARGE/);
  await assert.rejects(readNativeBody(response('x', 200, { 'content-encoding': 'gzip' })), /UNSUPPORTED_ENCODING/);
  await assert.rejects(readNativeBody(response('x', 200, { 'content-type': 'application/xml; charset=iso-8859-1' })), /UNSUPPORTED_ENCODING/);
  await assert.rejects(readNativeBody(response('x', 200, { 'content-length': '2' })), /INVALID_RESPONSE/);
  assert.equal(await readNativeBody(response('good', 200, { 'content-length': '4' })), 'good');
  await assert.rejects(readNativeBody({ status: 200, headers: new Headers(), body: { getReader: () => ({ read: async () => { throw new Error('Connection reset'); }, cancel: async () => {} }) } }), /FETCH_FAILED/);
});
test('native fetch sends no credentials, checks redirects, and drops cross-origin validators', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const transport: NativeTransport = async (url, init) => {
    calls.push({ url, init });
    return calls.length === 1 ? response('', 302, { location: 'https://other.example.org/rss' }) : response();
  };
  await fetchNativeFeed('https://example.org/rss', { etag: 'known', lastModified: 'safe' }, transport);
  assert.equal(calls.length, 2);
  assert.equal(new Headers(calls[0].init.headers).get('if-none-match'), 'known');
  assert.equal(new Headers(calls[1].init.headers).get('if-none-match'), null);
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(new Headers(calls[0].init.headers).get('authorization'), null);
  await assert.rejects(fetchNativeFeed('https://example.org/rss', {}, async () => response('', 302, { location: 'https://127.0.0.1/' })), /UNSAFE_URL/);
  await assert.rejects(fetchNativeFeed('https://example.org/rss', {}, async () => ({ ...response(), redirected: true })), /UNEXPECTED_REDIRECT/);
  await assert.rejects(fetchNativeFeed('https://example.org/rss', {}, async () => response('', 302, { location: '/again' })), /REDIRECT_LIMIT/);
  await assert.rejects(fetchNativeFeed('https://example.org/rss', {}, async () => response('', 304)), /UNEXPECTED_NOT_MODIFIED/);
});
test('native trigger requires the platform marker, with no app identity or secret', () => {
  for (const marker of [null, '', '  ']) assert.throws(() => authenticateNativeTrigger(marker), { status: 401 });
  authenticateNativeTrigger('1');
});
test('disabled native tick proves authentication without reading jobs or fetching', async () => {
  const { h, ctx } = setup(); ctx.env.FEEDS_NATIVE_INGESTION_ENABLED = 'false';
  const outcome = await nativeTick(ctx, async () => { throw new Error('No fetch'); });
  assert.deepEqual(outcome, { authenticated: true, enabled: false, outcome: 'disabled' });
  h.close();
});
test('one native tick ingests one due source, preserves state, and repeated calls respect due times', async () => {
  const { h, ctx } = setup();
  const source = await addSource(ctx, { title: 'One', url: 'https://example.org/rss' }, 1000);
  let calls = 0; const transport: NativeTransport = async () => { calls++; return response(); };
  assert.equal((await h.transaction(() => nativeTick(ctx, transport, () => 1000))).outcome, 'success');
  assert.equal((await h.transaction(() => nativeTick(ctx, transport, () => 2000))).outcome, 'idle');
  assert.equal(calls, 1);
  const article = (await dashboard(ctx)).articles[0];
  assert.equal(article.sourceId, source.id); assert.equal(article.bodyText, 'Safe text');
  await setArticleState(ctx, { id: article.id, read: true, starred: true });
  await h.transaction(() => nativeTick(ctx, transport, () => 3_601_001));
  const updated = (await dashboard(ctx)).articles;
  assert.equal(updated.length, 1); assert.equal(updated[0].read, true); assert.equal(updated[0].starred, true);
  await addSource(ctx, { title: 'Two', url: 'https://other.example.org/rss' }, 3_601_002);
  await h.transaction(() => nativeTick(ctx, transport, () => 3_601_002));
  assert.equal((await dashboard(ctx)).articles.length, 2);
  h.close();
});
test('native errors persist retry and recovery, but unexpected failures roll the entire attempt back', async () => {
  const { h, ctx } = setup();
  await addSource(ctx, { title: 'One', url: 'https://example.org/rss' }, 1000);
  const outcome = await h.transaction(() => nativeTick(ctx, async () => { throw new Error('private upstream error'); }, () => 1000));
  assert.equal(outcome.outcome, 'retry');
  let state = await dashboard(ctx); assert.equal(state.sources[0].nextPollAt, 31_000); assert.doesNotMatch(state.sources[0].error, /upstream/);
  assert.equal((await h.transaction(() => nativeTick(ctx, async () => response(), () => 31_000))).outcome, 'success');
  const saved = ctx.crypto.sha256; ctx.crypto.sha256 = async () => { throw new Error('host unavailable'); };
  await assert.rejects(h.transaction(() => nativeTick(ctx, async () => response(), () => 3_631_000)), /host unavailable/);
  ctx.crypto.sha256 = saved; state = await dashboard(ctx);
  assert.equal(state.sources[0].jobStatus, 'idle');
  assert.equal((await h.transaction(() => nativeTick(ctx, async () => response(), () => 3_631_000))).outcome, 'success');
  h.close();
});
test('native source defaults enable new feeds without credentials and refresh only queues', async () => {
  const { h, ctx } = setup();
  assert.equal(workerConfigured(ctx), false);
  const source = await addSource(ctx, { title: 'One', url: 'https://example.org/rss' }, 1000);
  assert.equal(source.enabled, true);
  await refreshSource(ctx, { id: source.id }, 2000);
  assert.equal((await dashboard(ctx)).articles.length, 0);
  assert.equal((await dashboard(ctx)).sources[0].jobStatus, 'queued');
  h.close();
});
