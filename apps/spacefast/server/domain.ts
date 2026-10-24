import type { ReadDatabaseOf, WriteDatabaseOf, QueryServerContext, ServerContext } from '@spacefast/zero/server';
import type { schema } from './schema.js';
import type { Article, Dashboard, NormalizedItem, WorkerResult } from '../shared/contracts.js';

type Definition = { schema: typeof schema };
export type ReadContext = Pick<QueryServerContext<ReadDatabaseOf<Definition>>, 'db' | 'auth' | 'env' | 'crypto'>;
export type WriteContext = Pick<ServerContext<WriteDatabaseOf<Definition>>, 'db' | 'auth' | 'env' | 'crypto' | 'invalidate'>;
const HOUR = 3_600_000;
const LEASE = 60_000;
const NEVER = 8_640_000_000_000_000;
const SOURCE_LIMIT = 25;
export const ARTICLE_LIMIT = 200;
export class DomainError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
function owner(ctx: ReadContext) {
  if (!ctx.auth.isAuthenticated || !ctx.auth.userId || ctx.auth.userId.startsWith('guest:')) throw new DomainError('Sign in to use Feeds.', 401);
  return ctx.auth.userId;
}
export function workerConfigured(ctx: Pick<ReadContext, 'env'>) {
  return !nativeIngestionConfigured(ctx) && ctx.env.FEEDS_WORKER_ENABLED === 'true' && (ctx.env.FEEDS_WORKER_SECRET?.length ?? 0) >= 32;
}
export function nativeSecretConfigured(ctx: Pick<ReadContext, 'env'>) {
  return /^[\x21-\x7e]{32,256}$/.test(ctx.env.CRON_SECRET ?? '');
}
export function nativeIngestionConfigured(ctx: Pick<ReadContext, 'env'>) {
  return ctx.env.FEEDS_NATIVE_INGESTION_ENABLED === 'true' && nativeSecretConfigured(ctx);
}
export function ingestionConfigured(ctx: Pick<ReadContext, 'env'>) {
  return nativeIngestionConfigured(ctx) || workerConfigured(ctx);
}
function text(value: unknown, max: number, name: string, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) throw new DomainError(`Invalid ${name}.`);
  return value.trim();
}
export function safeUrl(value: unknown): string {
  const raw = text(value, 2048, 'URL');
  let url: URL;
  try { url = new URL(raw); } catch { throw new DomainError('Enter an HTTPS feed URL.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !host.includes('.') || host.endsWith('.') || /(^|\.)(localhost|local|internal|test|invalid)$/.test(host) || host === 'metadata.google.internal' || /^[\d.:[\]]+$/.test(host)) throw new DomainError('Use a public HTTPS hostname without credentials or a custom port.');
  url.hash = '';
  return url.href;
}
function articleUrl(value: unknown) {
  if (!value) return '';
  try { return safeUrl(value); } catch { return ''; }
}
async function sourceFor(ctx: ReadContext, id: unknown) {
  const userId = owner(ctx);
  const source = await ctx.db.sources.get(text(id, 200, 'source ID'));
  if (!source || source.ownerId !== userId) throw new DomainError('Feed not found.', 404);
  return source;
}
export async function dashboard(ctx: ReadContext): Promise<Dashboard> {
  const userId = owner(ctx);
  const sources = await ctx.db.sources.withIndex('by_owner', q => q.eq('ownerId', userId)).take(SOURCE_LIMIT);
  const jobs = await ctx.db.jobs.withIndex('by_owner', q => q.eq('ownerId', userId)).take(SOURCE_LIMIT);
  const articles = await ctx.db.articles.withIndex('by_owner', q => q.eq('ownerId', userId)).order('desc').take(ARTICLE_LIMIT);
  return {
    workerConfigured: ingestionConfigured(ctx),
    sources: sources.map(s => ({ id: s.id, title: s.title, url: s.url, folder: s.folder, enabled: s.enabled, nextPollAt: s.nextPollAt, lastAttemptAt: s.lastAttemptAt, lastSuccessAt: s.lastSuccessAt, error: s.error, jobStatus: jobs.find(j => j.sourceId === s.id)?.status ?? 'paused' })),
    articles: articles.filter(a => sources.some(s => s.id === a.sourceId)).map(a => ({ id: a.id, sourceId: a.sourceId, sourceTitle: sources.find(s => s.id === a.sourceId)!.title, title: a.title, url: a.url, bodyText: a.bodyText.slice(0, 2000), author: a.author, publishedAt: a.publishedAt, read: a.read, starred: a.starred })),
  };
}
export async function article(ctx: ReadContext, input: { id: string }): Promise<Article> {
  const userId = owner(ctx);
  const row = await ctx.db.articles.get(text(input.id, 200, 'article ID'));
  if (!row || row.ownerId !== userId) throw new DomainError('Article not found.', 404);
  const source = await ctx.db.sources.get(row.sourceId);
  if (!source || source.ownerId !== userId) throw new DomainError('Article not found.', 404);
  return { id: row.id, sourceId: row.sourceId, sourceTitle: source.title, title: row.title, url: row.url, bodyText: row.bodyText, author: row.author, publishedAt: row.publishedAt, read: row.read, starred: row.starred };
}
export async function addSource(ctx: WriteContext, input: { title: string; url: string; folder?: string }, now = Date.now()) {
  const userId = owner(ctx);
  const url = safeUrl(input.url);
  const duplicate = await ctx.db.sources.withIndex('by_owner_url', q => q.eq('ownerId', userId).eq('url', url)).first();
  if (duplicate) return duplicate;
  const count = await ctx.db.sources.withIndex('by_owner', q => q.eq('ownerId', userId)).count();
  if (count >= SOURCE_LIMIT) throw new DomainError('This prototype supports 25 feeds per person.');
  const enabled = ingestionConfigured(ctx);
  const source = await ctx.db.sources.insert({ ownerId: userId, title: text(input.title, 200, 'feed title'), url, folder: text(input.folder ?? '', 100, 'folder', true), enabled, nextPollAt: now, lastAttemptAt: 0, lastSuccessAt: 0, error: '', etag: '', lastModified: '', demo: false });
  await ctx.db.jobs.insert({ ownerId: userId, sourceId: source.id, status: enabled ? 'queued' : 'paused', nextRunAt: enabled ? now : NEVER, leaseUntil: 0, leaseToken: '', leaseVersion: 0, attempts: 0, completedToken: '' });
  ctx.invalidate('dashboard', 'article');
  return source;
}
export async function updateSource(ctx: WriteContext, input: { id: string; enabled: boolean }, now = Date.now()) {
  const source = await sourceFor(ctx, input.id);
  if (typeof input.enabled !== 'boolean') throw new DomainError('Invalid enabled state.');
  if (input.enabled && (!ingestionConfigured(ctx) || source.demo)) throw new DomainError('Live ingestion is not configured for this feed.');
  await ctx.db.sources.update(source.id, { enabled: input.enabled, nextPollAt: now });
  const job = await ctx.db.jobs.withIndex('by_source', q => q.eq('sourceId', source.id)).first();
  if (job) await ctx.db.jobs.update(job.id, { status: input.enabled ? 'queued' : 'paused', nextRunAt: input.enabled ? now : NEVER, leaseToken: '', leaseUntil: 0 });
  ctx.invalidate('dashboard', 'article');
}
export async function deleteSource(ctx: WriteContext, input: { id: string }) {
  const source = await sourceFor(ctx, input.id);
  for (const article of await ctx.db.articles.withIndex('by_source', q => q.eq('sourceId', source.id)).take(ARTICLE_LIMIT)) await ctx.db.articles.delete(article.id);
  for (const job of await ctx.db.jobs.withIndex('by_source', q => q.eq('sourceId', source.id)).take(10)) await ctx.db.jobs.delete(job.id);
  await ctx.db.sources.delete(source.id);
  ctx.invalidate('dashboard', 'article');
}
export async function refreshSource(ctx: WriteContext, input: { id: string }, now = Date.now()) {
  const source = await sourceFor(ctx, input.id);
  if (!ingestionConfigured(ctx) || !source.enabled || source.demo) throw new DomainError('Enable this feed after configuring scheduled ingestion.');
  const job = await ctx.db.jobs.withIndex('by_source', q => q.eq('sourceId', source.id)).first();
  if (!job) throw new DomainError('Feed job is missing.', 409);
  if (job.status !== 'running' || job.leaseUntil <= now) await ctx.db.jobs.update(job.id, { status: 'queued', nextRunAt: now });
  ctx.invalidate('dashboard', 'article');
  return { jobId: job.id, status: job.status === 'running' && job.leaseUntil > now ? 'running' : 'queued' };
}
export async function setArticleState(ctx: WriteContext, input: { id: string; read?: boolean; starred?: boolean }) {
  const userId = owner(ctx);
  const article = await ctx.db.articles.get(text(input.id, 200, 'article ID'));
  if (!article || article.ownerId !== userId) throw new DomainError('Article not found.', 404);
  const patch: { read?: boolean; starred?: boolean } = {};
  if (input.read !== undefined) { if (typeof input.read !== 'boolean') throw new DomainError('Invalid read state.'); patch.read = input.read; }
  if (input.starred !== undefined) { if (typeof input.starred !== 'boolean') throw new DomainError('Invalid star state.'); patch.starred = input.starred; }
  await ctx.db.articles.update(article.id, patch);
  ctx.invalidate('dashboard', 'article');
}
export async function authenticateWorker(ctx: ReadContext, authorization: string | null) {
  if (!workerConfigured(ctx)) throw new DomainError('Ingestion worker is disabled.', 503);
  const expected = `Bearer ${ctx.env.FEEDS_WORKER_SECRET}`;
  if (!authorization || authorization.length !== expected.length || !await ctx.crypto.timingSafeEqual(authorization, expected)) throw new DomainError('Unauthorized worker.', 401);
}
// Durable scheduling is shared by native bounded ticks and the optional Node adapter.
export async function dispatch(ctx: WriteContext, now = Date.now()) {
  if (!ingestionConfigured(ctx)) return { queued: 0, disabled: true };
  const due = await ctx.db.jobs.withIndex('by_due', q => q.lte('nextRunAt', now)).take(50);
  let queued = 0;
  for (const job of due) {
    const source = await ctx.db.sources.get(job.sourceId);
    if (!source || !source.enabled || source.demo) continue;
    if (job.status === 'running' && job.leaseUntil > now) continue;
    if (job.status === 'running') {
      // A worker died: revoke its token and back off before redelivery.
      const retryAt = now + Math.min(HOUR, 30_000 * 2 ** Math.min(job.attempts, 7));
      await ctx.db.jobs.update(job.id, { status: 'retry', nextRunAt: retryAt, leaseToken: '', leaseUntil: 0 });
      await ctx.db.sources.update(source.id, { error: 'Worker lease expired; retry scheduled.', nextPollAt: retryAt });
    } else {
      await ctx.db.jobs.update(job.id, { status: 'queued' }); queued++;
    }
  }
  ctx.invalidate('dashboard', 'article');
  return { queued, disabled: false };
}
export async function claim(ctx: WriteContext, now = Date.now(), leaseKey = ctx.env.FEEDS_WORKER_SECRET ?? '') {
  await dispatch(ctx, now);
  const due = await ctx.db.jobs.withIndex('by_due', q => q.lte('nextRunAt', now)).take(50);
  for (const job of due) {
    if (job.status !== 'queued') continue;
    const source = await ctx.db.sources.get(job.sourceId);
    if (!source || !source.enabled || source.demo) continue;
    // HMAC prevents predicting a lease capability. Its generation also fences stale results.
    const leaseToken = await ctx.crypto.hmacSha256({ key: { value: leaseKey }, data: `${job.id}:${job.leaseVersion + 1}:${now}` });
    await ctx.db.jobs.update(job.id, { status: 'running', leaseToken, leaseVersion: job.leaseVersion + 1, leaseUntil: now + LEASE, nextRunAt: now + LEASE, attempts: job.attempts + 1 });
    await ctx.db.sources.update(source.id, { lastAttemptAt: now });
    ctx.invalidate('dashboard', 'article');
    return { jobId: job.id, leaseToken, sourceId: source.id, url: source.url, etag: source.etag, lastModified: source.lastModified };
  }
  return null;
}
function validateItems(items: unknown): NormalizedItem[] {
  if (!Array.isArray(items) || items.length > 50) throw new DomainError('Invalid item batch.');
  const keys = new Set<string>();
  return items.map((raw: NormalizedItem) => {
    if (!raw || typeof raw !== 'object') throw new DomainError('Invalid item.');
    const key = text(raw.key, 128, 'item key');
    if (keys.has(key)) throw new DomainError('Duplicate item key in batch.');
    keys.add(key);
    const publishedAt = text(raw.publishedAt, 50, 'published date', true);
    if (publishedAt && !Number.isFinite(Date.parse(publishedAt))) throw new DomainError('Invalid published date.');
    return { key, title: text(raw.title, 500, 'article title'), url: articleUrl(raw.url), bodyText: text(raw.bodyText, 50_000, 'article body', true), author: text(raw.author, 200, 'author', true), publishedAt };
  });
}
export async function finish(ctx: WriteContext, input: WorkerResult, now = Date.now()) {
  if (!input || typeof input !== 'object') throw new DomainError('Invalid result.');
  const job = await ctx.db.jobs.get(text(input.jobId, 200, 'job ID'));
  const token = text(input.leaseToken, 128, 'lease token');
  if (!job) throw new DomainError('Job not found.', 404);
  if (job.completedToken === token) return { duplicate: true };
  if (job.status !== 'running' || job.leaseToken !== token || job.leaseUntil <= now) throw new DomainError('Worker lease is stale.', 409);
  const source = await ctx.db.sources.get(job.sourceId);
  if (!source || !source.enabled) throw new DomainError('Feed is unavailable.', 409);
  if (!['success', 'not_modified', 'failure'].includes(input.status)) throw new DomainError('Invalid result status.');
  if (input.status === 'failure') {
    const next = now + Math.min(HOUR, 30_000 * 2 ** Math.min(job.attempts - 1, 7));
    await ctx.db.jobs.update(job.id, { status: 'retry', nextRunAt: next, leaseUntil: 0, leaseToken: '', completedToken: token });
    // Do not persist arbitrary fetch exception strings which may include URLs or secrets.
    await ctx.db.sources.update(source.id, { error: 'Feed could not be fetched. A retry is scheduled.', nextPollAt: next });
  } else {
    const items = input.status === 'success' ? validateItems(input.items) : [];
    const current = await ctx.db.articles.withIndex('by_source', q => q.eq('sourceId', source.id)).take(ARTICLE_LIMIT);
    const newCount = items.filter(item => !current.some(existing => existing.key === item.key)).length;
    if (current.length + newCount > ARTICLE_LIMIT) {
      // Do not delete history or retry a full store forever. Surface an explicit stop.
      await ctx.db.sources.update(source.id, { enabled: false, error: 'Paused: this feed reached the 200-article prototype limit. Export/reconciliation is required before expanding retention.' });
      await ctx.db.jobs.update(job.id, { status: 'capacity', nextRunAt: NEVER, leaseUntil: 0, leaseToken: '', completedToken: token });
      ctx.invalidate('dashboard', 'article');
      return { duplicate: false, capacityReached: true };
    }
    for (const item of items) {
      const existing = current.find(a => a.key === item.key);
      if (existing) await ctx.db.articles.update(existing.id, item);
      else {
        if (current.length >= ARTICLE_LIMIT) {
          // Bounded prototype retention: do not silently delete stars or unread history.
          throw new DomainError('Feed reached its 200-article prototype storage limit.', 409);
        }
        const inserted = await ctx.db.articles.insert({ ...item, ownerId: source.ownerId, sourceId: source.id, read: false, starred: false });
        current.push(inserted);
      }
    }
    const etag = text(input.etag ?? source.etag, 1024, 'ETag', true);
    const lastModified = text(input.lastModified ?? source.lastModified, 200, 'Last-Modified', true);
    const next = now + HOUR;
    await ctx.db.sources.update(source.id, { etag, lastModified, lastSuccessAt: now, nextPollAt: next, error: '' });
    await ctx.db.jobs.update(job.id, { status: 'idle', nextRunAt: next, leaseUntil: 0, leaseToken: '', leaseVersion: 0, attempts: 0, completedToken: token });
  }
  ctx.invalidate('dashboard', 'article');
  return { duplicate: false };
}
export async function seedDemo(ctx: WriteContext, _input: Record<string, never>, now = Date.now()) {
  const userId = owner(ctx);
  const existing = await ctx.db.sources.withIndex('by_owner_url', q => q.eq('ownerId', userId).eq('url', 'https://example.com/feeds-demo.xml')).first();
  if (existing) return { id: existing.id };
  const source = await addSource(ctx, { title: 'Feeds demo', url: 'https://example.com/feeds-demo.xml', folder: 'Demo' }, now);
  await ctx.db.sources.update(source.id, { demo: true, enabled: false, lastSuccessAt: now });
  const job = await ctx.db.jobs.withIndex('by_source', q => q.eq('sourceId', source.id)).first();
  if (job) await ctx.db.jobs.update(job.id, { status: 'demo', nextRunAt: NEVER });
  for (const [index, article] of [
    { title: 'Welcome to your reading space', bodyText: 'This is a clearly labeled demo article, not a fetched feed.\n\nFeeds keeps reading state and stars separate for each signed-in person. Open an article, star it, and mark it unread independently.\n\nThe original WordPress plugin remains unchanged in this repository.' },
    { title: 'Your feeds, in a standalone reader', bodyText: 'The interface uses WordPress Components and DataViews, with native Spacefast sign-in and database-backed personal data.\n\nAdd a public HTTPS feed in Manage feeds. Live fetching stays paused until native scheduled ingestion has been configured and verified.' },
    { title: 'How scheduled fetching works', bodyText: 'Feed documents are untrusted input. Spacefast protects outbound DNS and redirects. The native fetcher requires bounded reads, rejects XML entities, and extracts plain text.\n\nDurable job rows retain retries and leased work across missed scheduler ticks. Production concurrency and recovery still require a deployed validation run.' },
  ].entries()) await ctx.db.articles.insert({ ownerId: userId, sourceId: source.id, key: `demo-${index}`, title: article.title, url: '', bodyText: article.bodyText, author: 'Feeds prototype', publishedAt: new Date(now - index * HOUR).toISOString(), read: false, starred: index === 1 });
  ctx.invalidate('dashboard', 'article');
  return { id: source.id };
}
