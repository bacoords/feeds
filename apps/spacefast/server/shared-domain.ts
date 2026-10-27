import type { NormalizedItem, WorkerResult } from '../shared/contracts.js';
import { normalizeFeedUrl } from '../shared/opml.js';
import type { ReadContext, WriteContext } from './domain.js';

type Source = NonNullable<Awaited<ReturnType<WriteContext['db']['sources']['get']>>>;
type Pool = NonNullable<Awaited<ReturnType<WriteContext['db']['feedPools']['get']>>>;
type Item = NonNullable<Awaited<ReturnType<WriteContext['db']['feedItems']['get']>>>;
const HOUR = 3_600_000;
const LEASE = 60_000;
const NEVER = 8_640_000_000_000_000;
const LIMIT = 200;

// A successful credential-free fetch is still insufficient evidence when a URL
// might carry a capability. Share only conventional, query-free feed endpoints.
export function shareCandidate(url: string) {
  try {
    const parsed = new URL(url);
    return !parsed.search && /^\/(?:feed|rss|atom)(?:\.xml)?\/?$/i.test(parsed.pathname);
  } catch { return false; }
}

async function poolForUrl(ctx: ReadContext, url: string, ownerId: string) {
  const publicPool = await ctx.db.feedPools.withIndex('by_url_visibility', q => q.eq('url', url).eq('visibility', 'public')).first();
  if (publicPool) return publicPool;
  const privatePool = await ctx.db.feedPools.withIndex('by_url_owner', q => q.eq('url', url).eq('ownerId', ownerId)).first();
  return privatePool?.visibility === 'private' ? privatePool : null;
}

async function stateFor(ctx: ReadContext, ownerId: string, itemId: string) {
  return ctx.db.itemStates.withIndex('by_owner_item', q => q.eq('ownerId', ownerId).eq('itemId', itemId)).first();
}

async function saveState(ctx: WriteContext, ownerId: string, itemId: string, source: Source, read: boolean, starred: boolean) {
  const existing = await stateFor(ctx, ownerId, itemId);
  if (existing) await ctx.db.itemStates.update(existing.id, { read, starred, sourceId: source.id, sourceTitle: source.title });
  else if (read || starred) await ctx.db.itemStates.insert({ ownerId, itemId, sourceId: source.id, sourceTitle: source.title, read, starred });
}

async function matchItem(ctx: ReadContext, feedId: string, legacy: { key: string; url: string }, items?: Item[]) {
  const current = items ?? await ctx.db.feedItems.withIndex('by_feed', q => q.eq('feedId', feedId)).take(LIMIT);
  return current.find(item => item.key === legacy.key || (legacy.url && item.url === legacy.url));
}

/** Idempotent, additive migration. Old source/article/job rows remain as a rollback copy.
 * The legacy-to-shared map accepts old article IDs while clients reload. */
export async function linkLegacySource(ctx: WriteContext, source: Source, now: number) {
  const linked = await ctx.db.subscriptions.withIndex('by_source', q => q.eq('sourceId', source.id)).first();
  if (linked) return linked;
  const existing = await poolForUrl(ctx, source.url, source.ownerId);
  const pool = existing ?? await ctx.db.feedPools.insert({
    url: source.url, ownerId: source.ownerId, visibility: 'private',
    status: source.enabled && !source.demo ? 'queued' : 'paused',
    nextRunAt: source.enabled && !source.demo ? Math.max(now, source.nextPollAt) : NEVER,
    leaseUntil: 0, leaseToken: '', leaseVersion: 0, attempts: 0, completedToken: '',
    lastAttemptAt: source.lastAttemptAt, lastSuccessAt: source.lastSuccessAt,
    error: source.error, etag: source.etag, lastModified: source.lastModified,
  });
  const subscription = await ctx.db.subscriptions.insert({ ownerId: source.ownerId, sourceId: source.id, feedId: pool.id });
  if (source.enabled && !source.demo && pool.status === 'paused') await ctx.db.feedPools.update(pool.id, { status: 'queued', nextRunAt: now });
  const items = await ctx.db.feedItems.withIndex('by_feed', q => q.eq('feedId', pool.id)).take(LIMIT);
  const oldMaps = new Set((await ctx.db.legacyItemMaps.withIndex('by_owner', q => q.eq('ownerId', source.ownerId)).take(5_000)).map(map => map.legacyId));
  const ownerStates = new Map((await ctx.db.itemStates.withIndex('by_owner', q => q.eq('ownerId', source.ownerId)).take(5_000)).map(state => [state.itemId, state]));
  for (const legacy of await ctx.db.articles.withIndex('by_source', q => q.eq('sourceId', source.id)).take(LIMIT)) {
    if (oldMaps.has(legacy.id)) continue;
    const match = await matchItem(ctx, pool.id, legacy, items);
    if (!match && items.length >= LIMIT) continue; // Keep the unmapped owner row visible.
    const item = match ?? await ctx.db.feedItems.insert({ feedId: pool.id, key: legacy.key, title: legacy.title, url: legacy.url, bodyText: legacy.bodyText, author: legacy.author, publishedAt: legacy.publishedAt });
    if (!match) items.push(item);
    const existingState = ownerStates.get(item.id);
    if (existingState) ownerStates.set(item.id, (await ctx.db.itemStates.update(existingState.id, { read: existingState.read || legacy.read, starred: existingState.starred || legacy.starred }))!);
    else if (legacy.read || legacy.starred) ownerStates.set(item.id, await ctx.db.itemStates.insert({ ownerId: source.ownerId, itemId: item.id, sourceId: source.id, sourceTitle: source.title, read: legacy.read, starred: legacy.starred }));
    await ctx.db.legacyItemMaps.insert({ ownerId: source.ownerId, legacyId: legacy.id, itemId: item.id });
    oldMaps.add(legacy.id);
  }
  for (const job of await ctx.db.jobs.withIndex('by_source', q => q.eq('sourceId', source.id)).take(10)) {
    await ctx.db.jobs.update(job.id, { status: 'migrated', nextRunAt: NEVER, leaseUntil: 0, leaseToken: '' });
  }
  return subscription;
}

export async function migrateDueLegacy(ctx: WriteContext, now: number, maxSources = 2) {
  let migrated = 0;
  const due = await ctx.db.jobs.withIndex('by_due', q => q.lte('nextRunAt', now)).take(50);
  for (const job of due) {
    if (migrated >= maxSources) break;
    const source = await ctx.db.sources.get(job.sourceId);
    if (source && !source.demo) { await linkLegacySource(ctx, source, now); migrated++; }
  }
  return migrated;
}

export async function reconcileOwner(ctx: WriteContext, ownerId: string, now: number, maxSources = 2) {
  const sources = await ctx.db.sources.withIndex('by_owner', q => q.eq('ownerId', ownerId)).take(26);
  let migrated = 0;
  let remaining = 0;
  for (const source of sources) {
    if (source.demo || await ctx.db.subscriptions.withIndex('by_source', q => q.eq('sourceId', source.id)).first()) continue;
    if (migrated < maxSources) { await linkLegacySource(ctx, source, now); migrated++; }
    else remaining++;
  }
  return { migrated, remaining };
}

export async function sourcePool(ctx: ReadContext, sourceId: string) {
  const link = await ctx.db.subscriptions.withIndex('by_source', q => q.eq('sourceId', sourceId)).first();
  return link ? ctx.db.feedPools.get(link.feedId) : null;
}

export async function sharedItems(ctx: ReadContext, ownerId: string) {
  const links = await ctx.db.subscriptions.withIndex('by_owner', q => q.eq('ownerId', ownerId)).take(25);
  const states = await ctx.db.itemStates.withIndex('by_owner', q => q.eq('ownerId', ownerId)).take(5_000);
  const stateByItem = new Map(states.map(state => [state.itemId, state]));
  const result: { item: Item; sourceId: string; sourceTitle: string; read: boolean; starred: boolean }[] = [];
  const visible = new Set<string>();
  for (const link of links) {
    const source = await ctx.db.sources.get(link.sourceId);
    if (!source || source.ownerId !== ownerId) continue;
    for (const item of await ctx.db.feedItems.withIndex('by_feed', q => q.eq('feedId', link.feedId)).take(LIMIT)) {
      if (visible.has(item.id)) continue;
      visible.add(item.id);
      const state = stateByItem.get(item.id);
      result.push({ item, sourceId: source.id, sourceTitle: source.title, read: state?.read ?? false, starred: state?.starred ?? false });
    }
  }
  // Saved items remain readable after an unsubscribe, with an owner-only title snapshot.
  for (const state of states) {
    if (!state.starred || visible.has(state.itemId)) continue;
    const item = await ctx.db.feedItems.get(state.itemId);
    if (item) { visible.add(item.id); result.push({ item, sourceId: state.sourceId, sourceTitle: state.sourceTitle, read: state.read, starred: true }); }
  }
  return result;
}

export async function sharedItemForUser(ctx: ReadContext, ownerId: string, inputId: string) {
  const map = await ctx.db.legacyItemMaps.withIndex('by_legacy', q => q.eq('legacyId', inputId)).first();
  const itemId = map?.ownerId === ownerId ? map.itemId : inputId;
  const item = await ctx.db.feedItems.get(itemId);
  if (!item) return null;
  const state = await stateFor(ctx, ownerId, item.id);
  const links = await ctx.db.subscriptions.withIndex('by_owner_feed', q => q.eq('ownerId', ownerId).eq('feedId', item.feedId)).take(25);
  for (const link of links) {
    if (link.ownerId !== ownerId) continue;
    const source = await ctx.db.sources.get(link.sourceId);
    if (source?.ownerId === ownerId) return { item, sourceId: source.id, sourceTitle: source.title, read: state?.read ?? false, starred: state?.starred ?? false, source };
  }
  if (state?.starred) return { item, sourceId: state.sourceId, sourceTitle: state.sourceTitle, read: state.read, starred: true, source: null };
  return null;
}

export async function setSharedState(ctx: WriteContext, ownerId: string, itemId: string, patch: { read?: boolean; starred?: boolean }) {
  const found = await sharedItemForUser(ctx, ownerId, itemId);
  if (!found) return false;
  const existing = await stateFor(ctx, ownerId, found.item.id);
  const source = found.source;
  if (existing) await ctx.db.itemStates.update(existing.id, { ...patch });
  else if (source) await saveState(ctx, ownerId, found.item.id, source, patch.read ?? false, patch.starred ?? false);
  return true;
}

async function activeSubscribers(ctx: ReadContext, feedId: string) {
  let cursor: string | null = null;
  for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
    const page = await ctx.db.subscriptions.withIndex('by_feed', q => q.eq('feedId', feedId)).paginate({ cursor, numItems: 100 });
    for (const link of page.page) {
      const source = await ctx.db.sources.get(link.sourceId);
      if (source?.enabled && !source.demo && source.ownerId === link.ownerId) return true;
    }
    if (page.isDone) return false;
    cursor = page.continueCursor;
  }
  return true; // A very large feed must not lose its job because of a scan cap.
}

export async function claimShared(ctx: WriteContext, now: number, leaseKey: string | null) {
  for (const pool of await ctx.db.feedPools.withIndex('by_due', q => q.lte('nextRunAt', now)).take(50)) {
    if (pool.visibility === 'retired' || pool.status === 'paused' || pool.status === 'capacity') continue;
    if (!await activeSubscribers(ctx, pool.id)) {
      await ctx.db.feedPools.update(pool.id, { status: 'paused', nextRunAt: NEVER });
      continue;
    }
    if (pool.status === 'running') {
      if (pool.leaseUntil > now) continue;
      const retryAt = now + Math.min(HOUR, 30_000 * 2 ** Math.min(pool.attempts, 7));
      await ctx.db.feedPools.update(pool.id, { status: 'retry', nextRunAt: retryAt, leaseToken: '', leaseUntil: 0, error: 'Feed lease expired; retry scheduled.' });
      continue;
    }
    const leaseData = `${pool.id}:${pool.leaseVersion + 1}:${now}`;
    const leaseToken = leaseKey === null ? await ctx.crypto.sha256(leaseData) : await ctx.crypto.hmacSha256({ key: { value: leaseKey }, data: leaseData });
    await ctx.db.feedPools.update(pool.id, { status: 'running', leaseToken, leaseVersion: pool.leaseVersion + 1, leaseUntil: now + LEASE, nextRunAt: now + LEASE, attempts: pool.attempts + 1, lastAttemptAt: now });
    // Parser keys must survive convergence of two initially private pools for
    // the same URL, including entries with GUIDs but no article link.
    return { jobId: pool.id, leaseToken, sourceId: `url_${await ctx.crypto.sha256(pool.url)}`, url: pool.url, etag: pool.etag, lastModified: pool.lastModified };
  }
  return null;
}

function checkedItems(items: unknown): NormalizedItem[] {
  if (!Array.isArray(items) || items.length > 50) throw new Error('Invalid item batch.');
  const keys = new Set<string>();
  return items.map((item: NormalizedItem) => {
    if (!item || typeof item.key !== 'string' || item.key.length > 128 || !item.key || keys.has(item.key) || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 500 || typeof item.bodyText !== 'string' || item.bodyText.length > 50_000 || typeof item.url !== 'string' || item.url.length > 2048 || typeof item.author !== 'string' || item.author.length > 200 || typeof item.publishedAt !== 'string' || item.publishedAt.length > 50 || (item.publishedAt && !Number.isFinite(Date.parse(item.publishedAt)))) throw new Error('Invalid item.');
    if (item.url) { try { normalizeFeedUrl(item.url); } catch { throw new Error('Invalid item URL.'); } }
    keys.add(item.key); return item;
  });
}

async function mergePrivateIntoPublic(ctx: WriteContext, privatePool: Pool, publicPool: Pool) {
  const target = await ctx.db.feedItems.withIndex('by_feed', q => q.eq('feedId', publicPool.id)).take(LIMIT);
  const oldItems = await ctx.db.feedItems.withIndex('by_feed', q => q.eq('feedId', privatePool.id)).take(LIMIT);
  const legacyMaps = await ctx.db.legacyItemMaps.withIndex('by_owner', q => q.eq('ownerId', privatePool.ownerId)).take(5_000);
  const unmatched = oldItems.filter(oldItem => !target.some(item => item.key === oldItem.key || (oldItem.url && item.url === oldItem.url)));
  if (target.length + unmatched.length > LIMIT) return false; // Never hide unmapped private history.
  for (const oldItem of oldItems) {
    const found = await matchItem(ctx, publicPool.id, oldItem, target);
    const item = found ?? await ctx.db.feedItems.insert({ feedId: publicPool.id, key: oldItem.key, title: oldItem.title, url: oldItem.url, bodyText: oldItem.bodyText, author: oldItem.author, publishedAt: oldItem.publishedAt });
    if (!found) target.push(item);
    for (const state of await ctx.db.itemStates.withIndex('by_item', q => q.eq('itemId', oldItem.id)).take(100)) {
      const current = await stateFor(ctx, state.ownerId, item.id);
      if (current) await ctx.db.itemStates.update(current.id, { read: current.read || state.read, starred: current.starred || state.starred });
      else await ctx.db.itemStates.insert({ ownerId: state.ownerId, itemId: item.id, sourceId: state.sourceId, sourceTitle: state.sourceTitle, read: state.read, starred: state.starred });
      await ctx.db.itemStates.delete(state.id);
    }
    for (const map of legacyMaps) {
      if (map.itemId === oldItem.id) await ctx.db.legacyItemMaps.update(map.id, { itemId: item.id });
    }
  }
  for (const link of await ctx.db.subscriptions.withIndex('by_feed', q => q.eq('feedId', privatePool.id)).take(100)) await ctx.db.subscriptions.update(link.id, { feedId: publicPool.id });
  await ctx.db.feedPools.update(privatePool.id, { visibility: 'retired', status: 'paused', nextRunAt: NEVER });
  return true;
}

export async function finishShared(ctx: WriteContext, pool: Pool, input: WorkerResult, now: number) {
  if (pool.completedToken === input.leaseToken) return { duplicate: true };
  if (pool.status !== 'running' || pool.leaseToken !== input.leaseToken || pool.leaseUntil <= now) throw new Error('Worker lease is stale.');
  if (!await activeSubscribers(ctx, pool.id)) throw new Error('Feed is unavailable.');
  if (input.status === 'failure') {
    const next = now + Math.min(HOUR, 30_000 * 2 ** Math.min(pool.attempts - 1, 7));
    await ctx.db.feedPools.update(pool.id, { status: 'retry', nextRunAt: next, leaseUntil: 0, leaseToken: '', completedToken: input.leaseToken, error: 'Feed could not be fetched. A retry is scheduled.' });
    return { duplicate: false };
  }
  if (input.status !== 'success' && input.status !== 'not_modified') throw new Error('Invalid result status.');
  const items = input.status === 'success' ? checkedItems(input.items) : [];
  const current = await ctx.db.feedItems.withIndex('by_feed', q => q.eq('feedId', pool.id)).take(LIMIT);
  const inserts = items.filter(item => !current.some(existing => existing.key === item.key || (item.url && existing.url === item.url)));
  if (current.length + inserts.length > LIMIT) {
    await ctx.db.feedPools.update(pool.id, { status: 'capacity', nextRunAt: NEVER, leaseUntil: 0, leaseToken: '', completedToken: input.leaseToken, error: 'Paused: this feed reached the 200-article prototype limit.' });
    return { duplicate: false, capacityReached: true };
  }
  for (const item of items) {
    const match = await matchItem(ctx, pool.id, item, current);
    if (match) await ctx.db.feedItems.update(match.id, item);
    else current.push(await ctx.db.feedItems.insert({ ...item, feedId: pool.id }));
  }
  const next = now + HOUR;
  await ctx.db.feedPools.update(pool.id, { status: 'idle', nextRunAt: next, leaseUntil: 0, leaseToken: '', attempts: 0, completedToken: input.leaseToken, lastSuccessAt: now, error: '', etag: (input.etag ?? pool.etag).slice(0, 1024), lastModified: (input.lastModified ?? pool.lastModified).slice(0, 200) });
  if (input.status === 'success' && pool.visibility === 'private' && shareCandidate(pool.url)) {
    const publicPool = await ctx.db.feedPools.withIndex('by_url_visibility', q => q.eq('url', pool.url).eq('visibility', 'public')).first();
    if (publicPool) await mergePrivateIntoPublic(ctx, pool, publicPool);
    else await ctx.db.feedPools.update(pool.id, { visibility: 'public', ownerId: '' });
  }
  return { duplicate: false };
}

export async function updatePoolForSource(ctx: WriteContext, source: Source, enabled: boolean, now: number) {
  const pool = await sourcePool(ctx, source.id);
  if (!pool) return false;
  if (enabled && pool.status !== 'running') await ctx.db.feedPools.update(pool.id, { status: 'queued', nextRunAt: now });
  else if (!enabled && !await activeSubscribers(ctx, pool.id)) await ctx.db.feedPools.update(pool.id, { status: 'paused', nextRunAt: NEVER });
  return true;
}

export async function queuePool(ctx: WriteContext, source: Source, now: number) {
  const pool = await sourcePool(ctx, source.id);
  if (!pool) return null;
  if (pool.status !== 'running' || pool.leaseUntil <= now) await ctx.db.feedPools.update(pool.id, { status: 'queued', nextRunAt: now });
  return { jobId: pool.id, status: pool.status === 'running' && pool.leaseUntil > now ? 'running' : 'queued' };
}
