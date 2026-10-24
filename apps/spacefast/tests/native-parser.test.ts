import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { build } from 'esbuild';
import { analyzeZeroSource, compileZeroCapsule } from '@spacefast/zero-compile';
import { buildNativeParser } from '../scripts/build-native-parser.js';
import { nativePlainText, NATIVE_MAX_FEED_BYTES, NATIVE_MAX_ITEMS, parseNativeFeed, utf8ByteLength } from '../server/native-parser.js';

const sha256 = async (value: string) => createHash('sha256').update(value).digest('hex');
const rss = (items: string) => `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Test</title>${items}</channel></rss>`;
const item = '<item><guid>one</guid><title>One</title><link>https://example.com/posts/one</link><description>Hello</description></item>';
const parse = (xml: string, sourceId = 'source') => parseNativeFeed(xml, sourceId, 'https://example.com/feeds/all', sha256);
const rejects = async (xml: string, code: string) => assert.rejects(parse(xml), { name: 'NativeParseError', message: code, code });

test('native RSS returns plaintext, metadata and source-scoped stable keys', async () => {
  const xml = rss(`<item><guid isPermaLink="false">abc</guid><title>A &amp; B</title><link>https://example.com/post?a=1&amp;b=2</link><dc:creator xmlns:dc="urn:dc">Writer</dc:creator><pubDate>Sat, 24 Oct 2026 10:00:00 GMT</pubDate><content:encoded xmlns:content="urn:content"><![CDATA[<p>Hello <b>reader</b>.</p><script>alert(1)</script><img src="https://track.example.com/pixel"><p>Next &amp; last.</p>]]></content:encoded></item>`);
  const [article] = await parse(xml);
  assert.equal(article.title, 'A & B');
  assert.equal(article.url, 'https://example.com/post?a=1&b=2');
  assert.equal(article.author, 'Writer');
  assert.equal(article.publishedAt, '2026-10-24T10:00:00.000Z');
  assert.equal(article.bodyText, 'Hello reader.\n\nNext & last.');
  assert.equal(article.key, `item_${await sha256('source\0id:abc')}`);
  assert.equal((await parse(xml.replace('Hello', 'Changed')))[0].key, article.key);
  assert.notEqual((await parse(xml, 'other-source'))[0].key, article.key);
});

test('native Atom handles alternate links, namespaces and XHTML order', async () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>urn:one</id><title type="html">&lt;b&gt;Atom title&lt;/b&gt;</title><link rel="self" href="https://example.com/self"/><link rel="alternate" href="/article"/><author><name>Alice</name><uri>https://example.com/alice</uri></author><updated>2026-10-24T12:00:00Z</updated><content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Hello <b>bold</b> text.</p><script>bad()</script><p>Second.</p></div></content></entry></feed>`;
  const [article] = await parse(xml);
  assert.equal(article.title, 'Atom title');
  assert.equal(article.url, 'https://example.com/article');
  assert.equal(article.author, 'Alice');
  assert.equal(article.publishedAt, '2026-10-24T12:00:00.000Z');
  assert.equal(article.bodyText, 'Hello bold text.\n\nSecond.');
});

test('native RSS1 uses rdf:about and accepts UTF-8 BOM, CDATA, comments and PI', async () => {
  const xml = '\ufeff<?xml version="1.0"?><?stylesheet href="never-fetch"?><rdf:RDF xmlns:rdf="urn:rdf"><!-- comment --><item rdf:about="urn:id"><title>Unicode 📰 café</title><description><![CDATA[<p>Hello&nbsp;there</p>]]></description></item></rdf:RDF>';
  const [article] = await parse(xml);
  assert.equal(article.title, 'Unicode 📰 café');
  assert.equal(article.key, `item_${await sha256('source\0id:urn:id')}`);
  assert.equal(article.bodyText, 'Hello\u00a0there');
});

test('native parser caps unique items and crypto calls at 20', async () => {
  const entries = Array.from({ length: 50 }, (_, index) => `<item><guid>${index}</guid></item>`).join('');
  let calls = 0;
  const result = await parseNativeFeed(rss(item.repeat(100) + entries), 'source', 'https://example.com/feed', async value => { calls++; return sha256(value); });
  assert.equal(result.length, NATIVE_MAX_ITEMS);
  assert.equal(calls, NATIVE_MAX_ITEMS);
  assert.equal(new Set(result.map(article => article.key)).size, NATIVE_MAX_ITEMS);
});

test('native parser has deterministic URL/content fallback IDs', async () => {
  const [urlItem] = await parse(rss('<item><link>/one</link><title>One</title></item>'));
  assert.equal(urlItem.key, `item_${await sha256('source\0url:https://example.com/one')}`);
  const [contentItem] = await parse(rss('<item><title>One</title><description>Text</description></item>'));
  assert.equal(contentItem.key, `item_${await sha256('source\0content:One\0\0Text')}`);
  assert.equal((await parse(rss('<item/>')))[0].title, 'Untitled article');
});

test('native plaintext excludes active/nontext content, attributes and media', () => {
  const html = '<p>First</p><script>alert(1)</script><style>bad</style><textarea>bad</textarea><noscript>bad</noscript><template>bad</template><iframe src="https://track.example.com">bad</iframe><object>bad</object><embed src="x"><svg><text>bad</text></svg><math>bad</math><img src="https://track.example.com" onerror="bad"><p>Second &amp; last &#128240;.</p>';
  assert.equal(nativePlainText(html), 'First\n\nSecond & last 📰.');
  assert.equal(nativePlainText('<p>One<br>two</p><p>three</p>'), 'One\ntwo\n\nthree');
  assert.equal(nativePlainText('<div>Long text</div>', 4), 'Long');
  assert.equal(nativePlainText('x📰', 2), 'x', 'UTF-16 truncation must not split Unicode code points');
  assert.equal(nativePlainText('📰x', 2), '📰');
  assert.equal(nativePlainText('Hi\u0000\u0001there'), 'Hithere');
});

test('native item links drop unsafe targets without fetching anything', async () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'http://example.com', 'https://127.0.0.1', 'https://[::1]', 'https://2130706433', 'https://user:pass@example.com', 'https://example.com:444', 'https://localhost', 'https://metadata.google.internal', 'https://example.com/\npath', 'https://example.com\\evil']) {
    const [article] = await parse(rss(`<item><link><![CDATA[${url}]]></link></item>`));
    assert.equal(article.url, '', url);
  }
});

test('native item field lengths and invalid dates are bounded', async () => {
  const [article] = await parse(rss(`<item><title>${'t'.repeat(600)}</title><author>${'a'.repeat(300)}</author><description>${'x'.repeat(60_000)}</description><pubDate>not a date</pubDate></item>`));
  assert.equal(article.title.length, 500);
  assert.equal(article.author.length, 200);
  assert.equal(article.bodyText.length, 50_000);
  assert.equal(article.publishedAt, '');
});

test('native byte limit is UTF-8, not UTF-16 length', async () => {
  for (const text of ['', 'plain', 'é', '中', '📰', 'é中📰']) assert.equal(utf8ByteLength(text), Buffer.byteLength(text));
  await rejects('x'.repeat(NATIVE_MAX_FEED_BYTES + 1), 'BODY_TOO_LARGE');
  await rejects(rss(`<item><description>${'中'.repeat(Math.floor(NATIVE_MAX_FEED_BYTES / 3))}</description></item>`), 'BODY_TOO_LARGE');
  const prefix = '<rss><channel><item><description>';
  const suffix = '</description></item></channel></rss>';
  assert.equal((await parse(prefix + 'x'.repeat(NATIVE_MAX_FEED_BYTES - prefix.length - suffix.length) + suffix)).length, 1);
});

test('native parser rejects DTD/custom entities before any hashing', async () => {
  for (const xml of ['<!DOCTYPE rss SYSTEM "https://evil.example.com/evil"><rss/>', '<!ENTITY x "bomb"><rss/>', rss('<item><description><![CDATA[<!DOCTYPE x>]]></description></item>')]) await rejects(xml, 'FORBIDDEN_XML_DECLARATION');
  for (const value of ['&custom;', '&nbsp;', '&#0;', '&#xD800;', '&#1114112;', '&#;', '&#x;', '&amp', '&AMP;']) {
    await assert.rejects(parse(rss(`<item><title>${value}</title></item>`)), { name: 'NativeParseError' }, value);
    await assert.rejects(parse(`<feed><entry><link href="${value}"/></entry></feed>`), { name: 'NativeParseError' }, value);
  }
  const [article] = await parse(rss('<item><title>&lt; &gt; &quot; &apos; &amp; &#65; &#x1f4f0;</title></item>'));
  assert.equal(article.title, '< > " \' & A 📰');
});

test('native parser rejects legacy encodings, invalid characters and malformed declarations', async () => {
  for (const encoding of ['UTF-16', 'ISO-8859-1', 'windows-1252']) await rejects(`<?xml version="1.0" encoding="${encoding}"?><rss/>`, 'UNSUPPORTED_XML_ENCODING');
  await rejects('<?xml version="1.0" encoding="US-ASCII"?><rss><channel><title>é</title></channel></rss>', 'UNSUPPORTED_XML_ENCODING');
  await rejects(rss('<item><title>\ud800</title></item>'), 'UNSUPPORTED_XML_ENCODING');
  await rejects(rss('<item><title>\udfff</title></item>'), 'UNSUPPORTED_XML_ENCODING');
  for (const character of ['\0', '\u0001', '\ufffe', '\uffff']) await rejects(rss(`<item><title>${character}</title></item>`), 'INVALID_XML');
  for (const declaration of ['<?xml encoding="UTF-8"?>', '<?xml version="1.1"?>', '<?xml version="1.0" ENCODING="UTF-16"?>', '<?XML version="1.0"?>', '<?xml version="1.0" bad="yes"?>']) await rejects(`${declaration}<rss><channel/></rss>`, 'INVALID_XML');
});

test('native parser rejects malformed XML rather than tokenizer repairs', async () => {
  const bad = [
    '<rss><channel></rss>', '<rss><channel>', '<rss/><rss/>', '<rss/>junk', '<rss/><!--unfinished',
    '<rss/><?xml unfinished', '<rss/><![CDATA[unfinished', '<rss/><!unknown>', '<rss a="<"/>',
    '<rss a="1" a="2"/>', '<rss><channel/><!bogus></rss>', '<rss><!-- bad -- comment --><channel/></rss>',
    '<rss><channel><![CDATA[unfinished</channel></rss>', '<rss><channel>bad ]]> text</channel></rss>',
    '<rss><channel><?unterminated</channel></rss>', '<rss><channel/><? good?></rss>',
    '<rss><channel/><?1bad?></rss>', '<rss><channel/><!-----></rss>',
    '<rss __proto__="1" __proto__="2"><channel/></rss>',
  ];
  for (const xml of bad) await assert.rejects(parse(xml), { name: 'NativeParseError' }, xml);
  await rejects('<html><body>Not a feed</body></html>', 'UNSUPPORTED_FEED');
  await rejects('<rss/>', 'UNSUPPORTED_FEED');
});

test('native malformed long-whitespace attributes fail before upstream validation', async () => {
  await rejects('<rss ' + ' '.repeat(200_000) + '=x><channel/></rss>', 'INVALID_XML');
});

test('native depth/node/attribute limits reject hostile nested or broad inputs', async () => {
  await rejects(rss('<item>' + '<a>'.repeat(32) + 'x' + '</a>'.repeat(32) + '</item>'), 'XML_TOO_DEEP');
  await rejects(rss('<item>' + '<a/>'.repeat(10_000) + '</item>'), 'XML_TOO_COMPLEX');
  await rejects(rss(`<item ${Array.from({ length: 65 }, (_, index) => `a${index}="x"`).join(' ')}/>`), 'XML_TOO_COMPLEX');
  await rejects(rss('<item><description><![CDATA[' + '<div>'.repeat(33) + 'x' + '</div>'.repeat(33) + ']]></description></item>'), 'CONTENT_TOO_DEEP');
});

test('native source IDs and hash outputs are checked', async () => {
  for (const sourceId of ['', 'x'.repeat(257), 'a\0b']) await assert.rejects(parse(rss(item), sourceId), { message: 'INVALID_SOURCE' });
  await assert.rejects(parseNativeFeed(rss(item), 'source', 'https://example.com', async () => 'not-a-sha256'), { message: 'INVALID_HASH' });
  await rejects(rss(`<item><guid>${'x'.repeat(4097)}</guid></item>`), 'INVALID_ITEM_ID');
});

test('vendor output, upstream source hashes and license provenance reproduce exactly', async () => {
  await buildNativeParser(true);
  const provenance = JSON.parse(await readFile('server/vendor/feed-parsers.provenance.json', 'utf8'));
  assert.deepEqual(provenance.packages.map((entry: { name: string }) => entry.name).sort(), ['entities', 'fast-xml-parser', 'htmlparser2']);
  assert.ok(provenance.packages.every((entry: { resolved: string; integrity: string }) => entry.resolved.startsWith('https://registry.npmjs.org/') && entry.integrity.startsWith('sha512-')));
});

test('actual Zero analyzer and capsule compiler accept unmodified vendor source', async () => {
  const config = JSON.parse(await readFile('sf.jsonc', 'utf8'));
  const root = process.cwd();
  const analysis = await analyzeZeroSource(root, config.runtime);
  assert.ok(analysis.manifest.files.some(file => file.path === 'server/vendor/feed-parsers.js'));
  const compiled = await compileZeroCapsule({ root, analysis, appName: 'Feeds', previousSchema: null, migrationMode: 'safe', shellTitle: 'Feeds', linkThemeStylesheet: false, inspectPolicy: 'private', runnerSha256: null, centralRealtimeUrl: null });
  assert.ok(compiled.finalizePayload.endpointSources.length);
});

test('native parser executes without Node, DOM, Buffer, TextDecoder, fetch or globalThis', async () => {
  const bundle = await build({ stdin: { contents: "export { parseNativeFeed } from './server/native-parser.ts';", resolveDir: process.cwd(), sourcefile: 'native-parser-test.ts' }, bundle: true, write: false, platform: 'browser', target: 'es2022', format: 'iife', globalName: 'feedParser' });
  const context = createContext({ URL, input: rss(item), hash: sha256, globalThis: undefined, Buffer: undefined, TextDecoder: undefined, TextEncoder: undefined, fetch: undefined, process: undefined, require: undefined, window: undefined, document: undefined });
  runInContext(bundle.outputFiles[0].text, context, { timeout: 2000 });
  const result = await runInContext('feedParser.parseNativeFeed(input, "source", "https://example.com/feed", hash)', context, { timeout: 2000 });
  assert.equal(result[0].title, 'One');
  assert.equal(result[0].key, `item_${await sha256('source\0id:one')}`);
});
