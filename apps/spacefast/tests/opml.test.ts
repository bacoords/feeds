import assert from 'node:assert/strict';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { build } from 'esbuild';
import { normalizeFeedUrl, OPML_MAX_BYTES, OPML_MAX_FEEDS, parseOpml, SOURCE_LIMIT } from '../shared/opml.js';
import type { OpmlImportInput } from '../shared/opml.js';
import { addSource, claim, dashboard, finish, importOpml, setArticleState } from '../server/domain.js';
import type { WriteContext } from '../server/domain.js';
import { harness } from './harness.js';

const opml = (outlines: string) => `<?xml version="1.0" encoding="UTF-8"?><opml version="2.0"><head><title>Subscriptions</title></head><body>${outlines}</body></opml>`;
const outline = (index: number, attributes = '') => `<outline text="Feed ${index}" xmlUrl="https://feed${index}.example.com/rss" ${attributes}/>`;
const inputFor = (xml: string): OpmlImportInput => ({ xml, selectedIds: parseOpml(xml).entries.filter(entry => !entry.error && !entry.duplicateOf).map(entry => entry.id) });
const rejects = (xml: string, code?: string) => assert.throws(() => parseOpml(xml), code ? { name: 'OpmlParseError', code } : { name: 'OpmlParseError' });
const now = 1_000_000;

test('OPML preview preserves document order, nested folders, entities and normalized URLs', () => {
  const xml = '\ufeff' + opml('<outline text="News &amp; opinion"><outline text="Technology"><outline title="A &amp; B 📰" text="Ignored fallback" type="rss" xmlUrl="https://EXAMPLE.com:443/a/../rss?a=1&amp;b=2#fragment"/></outline></outline><outline xmlUrl="https://other.example.com/feed"/>');
  const preview = parseOpml(xml);
  assert.deepEqual(preview, { entries: [
    { id: 'opml-1', title: 'A & B 📰', url: 'https://example.com/rss?a=1&b=2', folder: 'News & opinion / Technology', error: null, duplicateOf: null },
    { id: 'opml-2', title: 'other.example.com', url: 'https://other.example.com/feed', folder: '', error: null, duplicateOf: null },
  ], duplicateCount: 0, invalidCount: 0 });
  assert.deepEqual(parseOpml(xml), preview);
});

test('OPML deduplicates canonical URLs, not unrelated query parameters or accounts', () => {
  const preview = parseOpml(opml('<outline title="First" xmlUrl="https://EXAMPLE.com:443/rss#one"/><outline title="Second" xmlUrl="https://example.com/rss#two"/><outline title="Other" xmlUrl="https://example.com/rss?key=other"/>'));
  assert.equal(preview.duplicateCount, 1);
  assert.equal(preview.entries[1].duplicateOf, 'opml-1');
  assert.equal(preview.entries[2].duplicateOf, null);
});

test('OPML reports invalid feeds without silently upgrading, truncating or discarding rows', () => {
  const preview = parseOpml(opml('<outline text="HTTP" xmlUrl="http://example.com/rss"/><outline type="rss" text="Missing URL"/><outline text="Empty URL" xmlUrl=""/><outline text="' + 't'.repeat(201) + '" xmlUrl="https://example.com/title"/><outline text="' + 'f'.repeat(99) + '"><outline text="Nested"><outline xmlUrl="https://example.com/folder"/></outline></outline>' + outline(1)));
  assert.equal(preview.entries.length, 6);
  assert.equal(preview.invalidCount, 5);
  assert.match(preview.entries[0].error!, /HTTPS/);
  assert.match(preview.entries[3].error!, /200/);
  assert.match(preview.entries[4].error!, /100/);
  assert.equal(preview.entries[5].error, null);
});

test('OPML labels remain inert text and special attribute names cannot poison object prototypes', () => {
  const preview = parseOpml(opml('<outline __proto__="ordinary" constructor="ordinary" text="&lt;img src=x onerror=alert(1)&gt;" xmlUrl="https://example.com/rss"/>'));
  assert.equal(preview.entries[0].title, '<img src=x onerror=alert(1)>');
  assert.equal(preview.entries[0].error, null);
  const controls = parseOpml(opml('<outline text="a&#10;b" xmlUrl="https://example.com/rss"/>'));
  assert.match(controls.entries[0].error!, /control/);
});

test('OPML supports comments, metadata CDATA and inert processing instructions', () => {
  const xml = '<?xml version="1.0"?><?stylesheet href="https://never-fetch.example.com/style"?><opml><head><title><![CDATA[An export]]></title></head><body><!-- comment -->' + outline(1) + '</body></opml>';
  assert.equal(parseOpml(xml).entries.length, 1);
});

test('OPML validates shape and rejects ambiguous attribute aliases', () => {
  for (const xml of ['', '<rss/>', '<opml/>', '<opml><body/><body/></opml>', opml(''), opml('<feed xmlUrl="https://example.com/rss"/>'), opml('<outline xmlUrl="https://example.com/a" xmlurl="https://example.com/b"/>')]) rejects(xml);
  assert.equal(parseOpml('<OPML><BODY><OUTLINE XMLURL="https://example.com/rss" TEXT="Example"/></BODY></OPML>').entries[0].title, 'Example');
});

test('OPML rejects DTD, external entities, unknown entities and invalid character references', () => {
  for (const xml of ['<!DOCTYPE opml SYSTEM "https://evil.example.com/ext.dtd"><opml><body/></opml>', '<!ENTITY x "bomb">' + opml(outline(1)), opml('<![CDATA[<!DOCTYPE x>]]>')]) rejects(xml, 'DECLARATION');
  for (const value of ['&custom;', '&nbsp;', '&#0;', '&#xD800;', '&#1114112;', '&#;', '&#x;', '&amp', '&AMP;']) rejects(opml(`<outline text="${value}" xmlUrl="https://example.com/rss"/>`));
  const title = parseOpml(opml('<outline text="&lt; &gt; &quot; &apos; &amp; &#65; &#x1f4f0;" xmlUrl="https://example.com/rss"/>')).entries[0].title;
  assert.equal(title, '< > " \' & A 📰');
});

test('OPML rejects malformed XML rather than accepting tokenizer repairs', () => {
  const malformed = [
    '<opml><body></opml>', '<opml><body>', '<opml/><opml/>', '<opml/>junk', '<opml/><!--unfinished',
    '<opml/><?xml unfinished', '<opml/><![CDATA[unfinished', '<opml/><!unknown>', '<opml a="<"/>',
    '<opml a="1" a="2"/>', '<opml><body/><!bogus></opml>', '<opml><!-- bad -- comment --><body/></opml>',
    '<opml><body><![CDATA[unfinished</body></opml>', '<opml><body>bad ]]> text</body></opml>',
    '<opml><body><?unterminated</body></opml>', '<opml><body/><? good?></opml>',
    '<opml><body/><?1bad?></opml>', '<opml><body/><!-----></opml>',
    '<opml __proto__="1" __proto__="2"><body/></opml>',
  ];
  for (const xml of malformed) rejects(xml);
  rejects('<opml ' + ' '.repeat(200_000) + '=x><body/></opml>');
});

test('OPML rejects unsupported encodings, malformed declarations and invalid Unicode', () => {
  for (const encoding of ['UTF-16', 'ISO-8859-1', 'windows-1252']) rejects(`<?xml version="1.0" encoding="${encoding}"?><opml/>`, 'ENCODING');
  rejects('<?xml version="1.0" encoding="US-ASCII"?><opml><head><title>é</title></head><body/></opml>', 'ENCODING');
  for (const character of ['\ud800', '\udfff']) rejects(opml(`<outline text="${character}" xmlUrl="https://example.com/rss"/>`), 'ENCODING');
  for (const character of ['\0', '\u0001', '\ufffe', '\uffff']) rejects(opml(`<outline text="${character}" xmlUrl="https://example.com/rss"/>`), 'INVALID_XML');
  for (const declaration of ['<?xml encoding="UTF-8"?>', '<?xml version="1.1"?>', '<?xml version="1.0" ENCODING="UTF-16"?>', '<?XML version="1.0"?>', '<?xml version="1.0" bad="yes"?>']) rejects(`${declaration}<opml><body>${outline(1)}</body></opml>`, 'INVALID_XML');
});

test('OPML has exact UTF-8 byte bounds and rejects rather than truncating at feed/depth/complexity bounds', () => {
  rejects('x'.repeat(OPML_MAX_BYTES + 1), 'TOO_LARGE');
  rejects(opml(`<outline text="${'中'.repeat(Math.floor(OPML_MAX_BYTES / 3))}"/>`), 'TOO_LARGE');
  const prefix = '<opml><head><title>', suffix = `</title></head><body>${outline(1)}</body></opml>`;
  assert.equal(parseOpml(prefix + 'x'.repeat(OPML_MAX_BYTES - prefix.length - suffix.length) + suffix).entries.length, 1);
  assert.equal(parseOpml(opml(Array.from({ length: OPML_MAX_FEEDS }, (_, index) => outline(index)).join(''))).entries.length, OPML_MAX_FEEDS);
  rejects(opml(Array.from({ length: OPML_MAX_FEEDS + 1 }, (_, index) => outline(index)).join('')), 'FEED_LIMIT');
  rejects(opml('<outline>'.repeat(24) + outline(1) + '</outline>'.repeat(24)), 'DEPTH');
  rejects(opml('<outline/>'.repeat(5_000)), 'COMPLEXITY');
  rejects(opml(`<outline ${Array.from({ length: 33 }, (_, index) => `a${index}="x"`).join(' ')}/>`), 'COMPLEXITY');
});

test('shared normalization rejects unsafe targets and does not change query identity', () => {
  for (const url of ['http://example.com', 'https://127.0.0.1', 'https://[::1]', 'https://0x7f000001', 'https://2130706433', 'https://u:p@example.com', 'https://example.com:444', 'https://localhost', 'https://metadata.google.internal', 'https://example.internal', 'https://example.com.', 'https://example.com/\npath', 'https://example.com\\evil', 'javascript:alert(1)', 'data:text/html,hello']) assert.throws(() => normalizeFeedUrl(url), url);
  assert.equal(normalizeFeedUrl(' https://EXAMPLE.com:443/rss#one '), 'https://example.com/rss');
  assert.equal(normalizeFeedUrl('https://example.com/rss?a=1&b=2'), 'https://example.com/rss?a=1&b=2');
});

test('OPML preview runs without DOM, Node, Buffer, text encoders, fetch or globalThis', async () => {
  const bundle = await build({ stdin: { contents: "export { parseOpml } from './shared/opml.ts';", resolveDir: process.cwd(), sourcefile: 'opml-portable-test.ts' }, bundle: true, write: false, platform: 'browser', target: 'es2022', format: 'iife', globalName: 'opmlParser' });
  const context = createContext({ URL, input: opml(outline(1)), globalThis: undefined, Buffer: undefined, TextDecoder: undefined, TextEncoder: undefined, fetch: undefined, process: undefined, require: undefined, window: undefined, document: undefined });
  runInContext(bundle.outputFiles[0].text, context, { timeout: 2000 });
  const result = runInContext('opmlParser.parseOpml(input)', context, { timeout: 2000 });
  assert.equal(result.entries[0].title, 'Feed 1');
  assert.equal(result.entries[0].url, 'https://feed1.example.com/rss');
});

test('OPML import is account-scoped, explicitly selected, and always creates paused sources/jobs', async () => {
  const h = harness(), alice = h.context(), bob = h.context('bob');
  const xml = opml('<outline text="Parent"><outline text="Child">' + outline(1) + outline(2) + '</outline></outline>');
  const request = { xml, selectedIds: ['opml-2'] };
  const one = await h.transaction(() => importOpml(alice, request, now));
  const two = await h.transaction(() => importOpml(bob, request, now));
  assert.deepEqual({ imported: one.imported, existing: one.existing }, { imported: 1, existing: 0 });
  assert.notEqual(one.sourceIds[0], two.sourceIds[0]);
  const source = (await dashboard(alice)).sources[0];
  assert.equal(source.url, 'https://feed2.example.com/rss');
  assert.equal(source.folder, 'Parent / Child');
  assert.equal(source.enabled, false);
  assert.equal(source.jobStatus, 'paused');
  assert.equal(await claim(alice, now), null);
  assert.equal(await h.db.articles.withIndex('by_owner').count(), 0);
  h.close();
});

test('OPML reimports preserve existing source metadata, jobs, article read/star state and account ownership', async () => {
  const h = harness(), ctx = h.context();
  const source = await addSource(ctx, { title: 'Original title', url: 'https://example.com/rss', folder: 'Original folder' }, now);
  const job = await claim(ctx, now); assert.ok(job);
  await finish(ctx, { ...job, status: 'success', etag: '"unchanged"', items: [{ key: 'article', title: 'Article', url: 'https://example.com/article', bodyText: 'Text', author: '', publishedAt: '' }] }, now + 1);
  const article = (await dashboard(ctx)).articles[0];
  await setArticleState(ctx, { id: article.id, read: true, starred: true });
  const beforeSource = await h.db.sources.get(source.id);
  const beforeJob = await h.db.jobs.withIndex('by_source', (q: any) => q.eq('sourceId', source.id)).first();
  const beforeArticle = await h.db.articles.get(article.id);
  const input = inputFor(opml('<outline text="Different folder"><outline title="Different title" xmlUrl="https://EXAMPLE.com:443/rss#fragment"/></outline>' + outline(1)));
  const first = await h.transaction(() => importOpml(ctx, input, now + 2));
  assert.equal(first.imported, 1); assert.equal(first.existing, 1);
  const second = await h.transaction(() => importOpml(ctx, input, now + 3));
  assert.equal(second.imported, 0); assert.equal(second.existing, 2);
  assert.deepEqual(second.sourceIds, first.sourceIds);
  assert.deepEqual(await h.db.sources.get(source.id), beforeSource);
  assert.deepEqual(await h.db.jobs.get(beforeJob.id), beforeJob);
  assert.deepEqual(await h.db.articles.get(article.id), beforeArticle);
  h.close();
});

test('OPML import rejects guests before reading data or parsing XML', async () => {
  const h = harness();
  for (const ctx of [h.context('guest:test'), { ...h.context('alice'), auth: { ...h.context().auth, isAuthenticated: false } } as WriteContext]) {
    await assert.rejects(importOpml(ctx, { xml: 'invalid', selectedIds: [] }), /Sign in/);
  }
  assert.equal(await h.db.sources.withIndex('by_owner').count(), 0);
  h.close();
});

test('OPML server reparses and validates IDs, labels, URLs and all selected rows before writes', async () => {
  const h = harness(), ctx = h.context();
  const xml = opml(outline(1) + '<outline text="Bad" xmlUrl="http://example.com/feed"/>');
  const invalidInputs: unknown[] = [null, {}, { xml, selectedIds: [] }, { xml, selectedIds: ['opml-1', 'opml-1'] }, { xml, selectedIds: ['opml-999'] }, { xml, selectedIds: ['opml-1', 'opml-2'] }, { xml, selectedIds: [1] }, { xml, selectedIds: Array(501).fill('opml-1') }, { xml: 'not XML', selectedIds: ['opml-1'] }, { xml: null, selectedIds: ['opml-1'] }, { xml: opml(outline(1) + outline(1)), selectedIds: ['opml-2'] }, { xml: opml(`<outline text="${'x'.repeat(201)}" xmlUrl="https://example.com/rss"/>`), selectedIds: ['opml-1'] }];
  for (const input of invalidInputs) {
    await assert.rejects(importOpml(ctx, input as OpmlImportInput));
    assert.equal(await h.db.sources.withIndex('by_owner').count(), 0);
    assert.equal(await h.db.jobs.withIndex('by_owner').count(), 0);
  }
  const forged = { xml: opml(outline(1)), selectedIds: ['opml-1'], ownerId: 'bob', enabled: true, title: 'Forged', folder: 'Forged', normalizedUrl: 'https://evil.example.com', limit: 999 };
  await importOpml(ctx, forged, now);
  const source = (await dashboard(ctx)).sources[0];
  assert.equal(source.title, 'Feed 1'); assert.equal(source.folder, ''); assert.equal(source.url, 'https://feed1.example.com/rss'); assert.equal(source.enabled, false);
  assert.equal((await dashboard(h.context('bob'))).sources.length, 0);
  h.close();
});

test('OPML retains 25-feed capacity with all-or-nothing validation and no silent truncation', async () => {
  const h = harness(), ctx = h.context('alice', false);
  const input = inputFor(opml(Array.from({ length: SOURCE_LIMIT + 1 }, (_, index) => outline(index)).join('')));
  await assert.rejects(importOpml(ctx, input, now), /No feeds were imported.*25.*26/);
  assert.equal((await dashboard(ctx)).sources.length, 0);
  await importOpml(ctx, { ...input, selectedIds: input.selectedIds.slice(0, 24) }, now);
  await assert.rejects(importOpml(ctx, { ...input, selectedIds: input.selectedIds.slice(24) }, now), /1 slots remain.*2 new feeds/);
  assert.equal((await dashboard(ctx)).sources.length, 24);
  const mixed = await importOpml(ctx, { ...input, selectedIds: [input.selectedIds[0], input.selectedIds[24]] }, now);
  assert.equal(mixed.imported, 1); assert.equal(mixed.existing, 1);
  assert.equal((await dashboard(ctx)).sources.length, SOURCE_LIMIT);
  assert.equal((await importOpml(ctx, { ...input, selectedIds: [input.selectedIds[0]] }, now)).existing, 1);
  assert.equal(await h.db.jobs.withIndex('by_owner').count(), SOURCE_LIMIT);
  h.close();
});

test('OPML write failures propagate and roll back sources and jobs in the transaction harness', async () => {
  const h = harness(), ctx = h.context();
  const original = await addSource(ctx, { title: 'Existing', url: 'https://existing.example.com/rss' }, now);
  const insertJob = h.db.jobs.insert;
  let calls = 0;
  h.db.jobs.insert = async (value: Record<string, unknown>) => {
    if (++calls === 2) throw new Error('Injected database failure');
    return insertJob(value);
  };
  await assert.rejects(h.transaction(() => importOpml(ctx, inputFor(opml(outline(1) + outline(2))), now)), /Injected database failure/);
  assert.deepEqual((await dashboard(ctx)).sources.map(source => source.id), [original.id]);
  assert.equal(await h.db.jobs.withIndex('by_owner').count(), 1);
  h.close();
});
