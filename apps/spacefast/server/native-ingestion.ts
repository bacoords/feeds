import { claim, DomainError, finish, nativeIngestionConfigured, type WriteContext } from './domain.js';
import { fetchNativeFeed, NativeFetchError, type NativeTransport } from './native-fetch.js';
import { parseNativeFeed, NativeParseError } from './native-parser.js';

/** Spacefast reserves this marker for its native scheduler. Manual cron runs
 * intentionally cannot send it (https://spacefast.com/docs/crons). No visitor
 * identity, caller URL or bearer credential grants access to this global tick. */
export function authenticateNativeTrigger(marker: string | null) {
  if (!marker?.trim()) throw new DomainError('Native scheduler required.', 401);
}

/** A small sequential batch in one host write transaction. Each outbound fetch
 * has its own five-second limit. A hard termination rolls the whole batch back,
 * leaving jobs due for the next tick. This is deliberately a per-tick cap, not
 * a promise that an arbitrarily large backlog clears in one hour. */
export const MAX_FEEDS_PER_TICK = 4;
export const MAX_TICK_MS = 22_000;
export async function nativeTick(ctx: WriteContext, transport?: NativeTransport, clock = Date.now) {
  if (!nativeIngestionConfigured(ctx)) return { authenticated: true, enabled: false, outcome: 'disabled' };
  const started = clock();
  const outcomes: string[] = [];
  for (let index = 0; index < MAX_FEEDS_PER_TICK && clock() - started < MAX_TICK_MS; index++) {
    const job = await claim(ctx, clock(), null);
    if (!job) break;
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
      continue;
    }
    const result = await finish(ctx, { jobId: job.jobId, leaseToken: job.leaseToken, status: fetched.status, items, etag: fetched.etag, lastModified: fetched.lastModified }, clock());
    outcomes.push(result.capacityReached ? 'capacity' : fetched.status);
  }
  return { authenticated: true, enabled: true, outcome: outcomes.length === 0 ? 'idle' : outcomes.length === 1 ? outcomes[0] : 'batch', processed: outcomes.length, outcomes };
}
