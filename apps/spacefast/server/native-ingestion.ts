import { claim, DomainError, finish, nativeIngestionConfigured, type WriteContext } from './domain.js';
import { fetchNativeFeed, NativeFetchError, type NativeTransport } from './native-fetch.js';
import { parseNativeFeed, NativeParseError } from './native-parser.js';
import { migrateDueLegacy } from './shared-domain.js';

/** Spacefast reserves this marker for its native scheduler. Manual cron runs
 * intentionally cannot send it (https://spacefast.com/docs/crons). No visitor
 * identity, caller URL or bearer credential grants access to this global tick. */
export function authenticateNativeTrigger(marker: string | null) {
  if (!marker?.trim()) throw new DomainError('Native scheduler required.', 401);
}

/** Drain due pools sequentially while work is cheap. The item cap and a soft
 * admission budget bound work in this one write transaction. The reserve uses
 * the observed cost of previous feeds and the host's five-second outbound
 * fetch limit; parsing and database writes can still exceed the target, so it
 * is not a platform runtime guarantee. A terminated transaction rolls back. */
export const MAX_FEEDS_PER_TICK = 100;
export const TICK_TARGET_MS = 30_000;
const MIN_NEXT_FEED_RESERVE_MS = 7_000;
export async function nativeTick(ctx: WriteContext, transport?: NativeTransport, clock = Date.now) {
  if (!nativeIngestionConfigured(ctx)) return { authenticated: true, enabled: false, outcome: 'disabled' };
  const started = clock();
  const migratedLegacy = await migrateDueLegacy(ctx, started, 2);
  const outcomes: string[] = [];
  const processedIds = new Set<string>();
  let nextFeedReserve = MIN_NEXT_FEED_RESERVE_MS;
  let stoppedForBudget = false;
  for (let index = 0; index < MAX_FEEDS_PER_TICK; index++) {
    if (clock() - started + nextFeedReserve > TICK_TARGET_MS) { stoppedForBudget = true; break; }
    const job = await claim(ctx, clock(), null, { migrateLegacy: false, skipJobIds: processedIds });
    if (!job) break;
    processedIds.add(job.jobId);
    const feedStarted = clock();
    let fetched;
    let items;
    try {
      fetched = await fetchNativeFeed(job.url, { etag: job.etag, lastModified: job.lastModified }, transport);
      items = fetched.status === 'success'
        ? await parseNativeFeed(fetched.xml ?? '', job.sourceId, fetched.finalUrl, value => ctx.crypto.sha256(value))
        : undefined;
    } catch (error) {
      if (!(error instanceof NativeFetchError) && !(error instanceof NativeParseError)) throw error;
      await finish(ctx, { jobId: job.jobId, leaseToken: job.leaseToken, status: 'failure' }, clock());
      outcomes.push('retry');
      nextFeedReserve = Math.max(nextFeedReserve, clock() - feedStarted);
      continue;
    }
    const result = await finish(ctx, { jobId: job.jobId, leaseToken: job.leaseToken, status: fetched.status, items, etag: fetched.etag, lastModified: fetched.lastModified }, clock(), fetched.finalUrl === job.url);
    outcomes.push(result.capacityReached ? 'capacity' : fetched.status);
    nextFeedReserve = Math.max(nextFeedReserve, clock() - feedStarted);
  }
  const remainingDueRows = await ctx.db.feedPools.withIndex('by_due', q => q.lte('nextRunAt', clock())).count();
  const remainingLegacyDueRows = await ctx.db.jobs.withIndex('by_due', q => q.lte('nextRunAt', clock())).count();
  return { authenticated: true, enabled: true, outcome: outcomes.length === 0 ? 'idle' : outcomes.length === 1 ? outcomes[0] : 'batch', processed: outcomes.length, outcomes, migratedLegacy, remainingDueRows, remainingLegacyDueRows, stoppedForBudget, reachedItemCap: outcomes.length === MAX_FEEDS_PER_TICK };
}
