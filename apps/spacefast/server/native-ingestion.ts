import { claim, DomainError, finish, nativeIngestionConfigured, type WriteContext } from './domain.js';
import { fetchNativeFeed, NativeFetchError, type NativeTransport } from './native-fetch.js';
import { parseNativeFeed, NativeParseError } from './native-parser.js';

/** Spacefast reserves this marker for its native scheduler. Manual cron runs
 * intentionally cannot send it (https://spacefast.com/docs/crons). No visitor
 * identity, caller URL or bearer credential grants access to this global tick. */
export function authenticateNativeTrigger(marker: string | null) {
  if (!marker?.trim()) throw new DomainError('Native scheduler required.', 401);
}

/** One due source, in the host's single write transaction. A hard termination
 * rolls the attempt back; the durable due job remains for the next tick.
 * Only the one declared platform scheduler may enter; overlaps are skipped. */
export async function nativeTick(ctx: WriteContext, transport?: NativeTransport, clock = Date.now) {
  if (!nativeIngestionConfigured(ctx)) return { authenticated: true, enabled: false, outcome: 'disabled' };
  const job = await claim(ctx, clock(), null);
  if (!job) return { authenticated: true, enabled: true, outcome: 'idle' };
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
    return { authenticated: true, enabled: true, outcome: 'retry' };
  }
  const result = await finish(ctx, { jobId: job.jobId, leaseToken: job.leaseToken, status: fetched.status, items, etag: fetched.etag, lastModified: fetched.lastModified }, clock());
  return { authenticated: true, enabled: true, outcome: result.capacityReached ? 'capacity' : fetched.status };
}
