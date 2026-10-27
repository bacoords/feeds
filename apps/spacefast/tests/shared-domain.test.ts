import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './harness.js';
import { addSource, article, claim, dashboard, deleteSource, finish, reconcileLegacy, setArticleState } from '../server/domain.js';
import { MAX_FEEDS_PER_TICK, nativeTick } from '../server/native-ingestion.js';
import type { NativeResponse, NativeTransport } from '../server/native-fetch.js';
import { shareCandidate } from '../server/shared-domain.js';

function response(url = 'https://example.org/story', title = 'First', headers: Record<string, string> = {}): NativeResponse {
  const xml = `<rss><channel><item><guid>one</guid><title>${title}</title><link>${url}</link><description>Body</description></item></channel></rss>`;
  const chunks = [new TextEncoder().encode(xml)];
  return { status: 200, headers: new Headers(headers), body: { getReader: () => ({ read: async () => chunks.length ? { done: false, value: chunks.shift()! } : { done: true }, cancel: async () => {} }) } };
}
function setup() {
  const h = harness(); const alice = h.context('alice'); const bob = h.context('bob');
  alice.env = {}; bob.env = {};
  return { h, alice, bob };
}

test('only conventional query-free feed URLs can be promoted after a successful fetch', () => {
  assert.equal(shareCandidate('https://example.org/feed'), true);
  assert.equal(shareCandidate('https://example.org/rss.xml'), true);
  for (const url of ['https://example.org/feed?key=secret', 'https://example.org/private/token/feed', 'https://example.org/a.xml']) assert.equal(shareCandidate(url), false);
});

test('hourly tick takes a bounded batch, isolates a feed failure, and leaves backlog due', async () => {
  const { h, alice } = setup();
  for (let index = 0; index < MAX_FEEDS_PER_TICK + 1; index++) await addSource(alice, { title: `Feed ${index}`, url: `https://feed${index}.example.org/rss` }, 1000);
  const fetched: string[] = [];
  const transport: NativeTransport = async url => {
    fetched.push(String(url));
    if (String(url).includes('feed1.')) throw new Error('upstream error with private details');
    return response();
  };
  const first = await h.transaction(() => nativeTick(alice, transport, () => 1000));
  assert.equal(first.outcome, 'batch'); assert.equal(first.processed, MAX_FEEDS_PER_TICK);
  assert.equal(fetched.length, MAX_FEEDS_PER_TICK);
  assert.equal((await dashboard(alice)).sources.filter(source => source.jobStatus === 'retry').length, 1);
  const second = await h.transaction(() => nativeTick(alice, transport, () => 1001));
  assert.equal(second.processed, 1);
  assert.equal(fetched.length, MAX_FEEDS_PER_TICK + 1);
  h.close();
});

test('tick stops admitting new feeds when the batch time budget is spent', async () => {
  const { h, alice } = setup();
  for (let index = 0; index < 5; index++) await addSource(alice, { title: `Feed ${index}`, url: `https://slow${index}.example.org/rss` }, 1000);
  let now = 1000;
  const result = await h.transaction(() => nativeTick(alice, async () => { now += 8000; return response(); }, () => now));
  assert.equal(result.processed, 3);
  assert.equal((await dashboard(alice)).sources.filter(source => source.jobStatus === 'queued').length, 2);
  h.close();
});

test('confirmed public feed is fetched once for two subscribers; state and unsubscribe stay private', async () => {
  const { h, alice, bob } = setup();
  const first = await addSource(alice, { title: 'Alice name', url: 'https://example.org/feed' }, 1000);
  let fetched = 0;
  await h.transaction(() => nativeTick(alice, async () => { fetched++; return response(); }, () => 1000));
  const second = await addSource(bob, { title: 'Bob name', url: 'https://example.org/feed' }, 2000);
  assert.notEqual(first.id, second.id);
  const pools = await h.db.feedPools.withIndex('by_url', (q: any) => q.eq('url', 'https://example.org/feed')).collect();
  assert.equal(pools.length, 1); assert.equal(pools[0].visibility, 'public');
  assert.equal((await dashboard(bob)).articles.length, 1);
  const aliceItem = (await dashboard(alice)).articles[0];
  await setArticleState(alice, { id: aliceItem.id, read: true, starred: true });
  assert.equal((await dashboard(bob)).articles[0].starred, false);
  await deleteSource(alice, { id: first.id });
  assert.equal((await dashboard(alice)).articles[0].starred, true);
  assert.equal((await article(alice, { id: aliceItem.id })).sourceTitle, 'Alice name');
  assert.equal((await dashboard(bob)).sources.length, 1);
  assert.equal(fetched, 1);
  h.close();
});

test('two pending subscriptions converge on one public pool after first successful fetch', async () => {
  const { h, alice, bob } = setup();
  await addSource(alice, { title: 'A', url: 'https://example.org/rss' }, 1000);
  await addSource(bob, { title: 'B', url: 'https://example.org/rss' }, 1000);
  assert.equal((await h.db.feedPools.withIndex('by_url').count()), 2);
  await h.transaction(() => nativeTick(alice, async () => response(''), () => 1000));
  const pools = await h.db.feedPools.withIndex('by_url').collect();
  assert.equal(pools.filter((pool: any) => pool.visibility === 'public').length, 1);
  assert.equal(pools.filter((pool: any) => pool.visibility === 'retired').length, 1);
  assert.equal((await h.db.feedItems.withIndex('by_feed', (q: any) => q.eq('feedId', pools.find((pool: any) => pool.visibility === 'public').id)).count()), 1);
  assert.equal((await dashboard(alice)).articles.length, 1);
  assert.equal((await dashboard(bob)).articles.length, 1);
  h.close();
});

test('token-bearing and uncertain URLs stay owner-scoped after successful fetches', async () => {
  const { h, alice, bob } = setup();
  await addSource(alice, { title: 'A', url: 'https://example.org/feed?token=alice' }, 1000);
  await addSource(bob, { title: 'B', url: 'https://example.org/feed?token=alice' }, 1000);
  await h.transaction(() => nativeTick(alice, async () => response(), () => 1000));
  const pools = await h.db.feedPools.withIndex('by_url').collect();
  assert.equal(pools.length, 2);
  assert.ok(pools.every((pool: any) => pool.visibility === 'private'));
  assert.notEqual((await dashboard(alice)).articles[0].id, (await dashboard(bob)).articles[0].id);
  h.close();
});

test('legacy migration maps old IDs and reading state without deleting old rows or jobs', async () => {
  const { h, alice, bob } = setup();
  alice.env = { FEEDS_NATIVE_INGESTION_ENABLED: 'false', FEEDS_WORKER_ENABLED: 'true', FEEDS_WORKER_SECRET: 'test-only-not-a-live-secret-0000000000' };
  const source = await addSource(alice, { title: 'Old feed', url: 'https://example.org/feed' }, 1000);
  const old = await h.db.articles.insert({ ownerId: 'alice', sourceId: source.id, key: 'old-key', title: 'Kept', url: 'https://example.org/kept', bodyText: 'Saved text', author: '', publishedAt: '', read: true, starred: true });
  alice.env = {};
  const result = await h.transaction(() => reconcileLegacy(alice, 2000));
  assert.equal(result.migrated, 1);
  assert.ok(await h.db.articles.get(old.id));
  assert.ok(await h.db.jobs.withIndex('by_source', (q: any) => q.eq('sourceId', source.id)).first());
  assert.equal((await article(alice, { id: old.id })).starred, true);
  assert.equal((await dashboard(alice)).articles.length, 1);
  await assert.rejects(article(bob, { id: old.id }), { status: 404 });
  assert.equal((await h.transaction(() => reconcileLegacy(alice, 2001))).migrated, 0);
  h.close();
});

test('legacy saved item maps into an already public feed by article URL', async () => {
  const { h, alice, bob } = setup();
  alice.env = { FEEDS_NATIVE_INGESTION_ENABLED: 'false', FEEDS_WORKER_ENABLED: 'true', FEEDS_WORKER_SECRET: 'test-only-not-a-live-secret-0000000000' };
  const oldSource = await addSource(alice, { title: 'Old', url: 'https://example.org/feed' }, 1000);
  const old = await h.db.articles.insert({ ownerId: 'alice', sourceId: oldSource.id, key: 'old-key', title: 'Old title', url: 'https://example.org/story', bodyText: 'Old body', author: '', publishedAt: '', read: true, starred: true });
  await addSource(bob, { title: 'New', url: 'https://example.org/feed' }, 1000);
  await h.transaction(() => nativeTick(bob, async () => response(), () => 1000));
  alice.env = {};
  await h.transaction(() => reconcileLegacy(alice, 2000));
  const visible = (await dashboard(alice)).articles;
  assert.equal(visible.length, 1);
  assert.equal(visible[0].starred, true);
  assert.equal((await article(alice, { id: old.id })).id, visible[0].id);
  assert.equal((await dashboard(bob)).articles[0].starred, false);
  h.close();
});

test('shared leases fence stale completions and a retry does not block other feeds', async () => {
  const { h, alice } = setup();
  await addSource(alice, { title: 'A', url: 'https://one.example.org/feed' }, 1000);
  await addSource(alice, { title: 'B', url: 'https://two.example.org/feed' }, 1000);
  const first = await h.transaction(() => claim(alice, 1000, null)); assert.ok(first);
  const second = await h.transaction(() => claim(alice, 1000, null)); assert.ok(second);
  assert.notEqual(first.jobId, second.jobId);
  assert.equal(await h.transaction(() => claim(alice, 1000, null)), null);
  await h.transaction(() => finish(alice, { jobId: first.jobId, leaseToken: first.leaseToken, status: 'failure' }, 1001));
  await h.transaction(() => finish(alice, { jobId: second.jobId, leaseToken: second.leaseToken, status: 'success', items: [] }, 1001));
  assert.deepEqual(await h.transaction(() => finish(alice, { jobId: first.jobId, leaseToken: first.leaseToken, status: 'success', items: [] }, 1002)), { duplicate: true });
  assert.equal((await h.db.feedPools.get(first.jobId)).status, 'retry');
  h.close();
});

test('shared validators survive not-modified responses without resetting article state', async () => {
  const { h, alice } = setup();
  await addSource(alice, { title: 'A', url: 'https://one.example.org/feed' }, 1000);
  await h.transaction(() => nativeTick(alice, async () => response(undefined, undefined, { etag: '"first"' }), () => 1000));
  const saved = (await dashboard(alice)).articles[0];
  await setArticleState(alice, { id: saved.id, starred: true });
  let validator = '';
  const notModified: NativeTransport = async (_url, init) => {
    validator = new Headers(init.headers).get('if-none-match') ?? '';
    return { status: 304, headers: new Headers({ etag: '"first"' }) };
  };
  await h.transaction(() => nativeTick(alice, notModified, () => 3_601_000));
  assert.equal(validator, '"first"');
  assert.equal((await dashboard(alice)).articles[0].starred, true);
  assert.equal((await h.db.feedItems.withIndex('by_feed').count()), 1);
  h.close();
});
