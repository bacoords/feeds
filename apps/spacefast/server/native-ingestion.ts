import { claim, DomainError, finish, nativeIngestionConfigured, nativeSecretConfigured, type WriteContext } from './domain.js';
import { fetchNativeFeed, NativeFetchError, type NativeTransport } from './native-fetch.js';
import { parseNativeFeed, NativeParseError } from './native-parser.js';

export async function authenticateNativeTrigger(ctx: WriteContext, authorization: string | null) {
  if (!nativeSecretConfigured(ctx)) throw new DomainError('Scheduled ingestion is not configured.', 503);
  const expected = `Bearer ${ctx.env.CRON_SECRET}`;
  if (!authorization || authorization.length !== expected.length || !await ctx.crypto.timingSafeEqual(authorization, expected)) throw new DomainError('Unauthorized trigger.', 401);
}

/** One due source, in the host's single write transaction. A hard termination
 * rolls the attempt back; the durable due job remains for the next tick.
 * Run exactly one non-overlapping scheduler. Hosted locking remains a gate. */
export async function nativeTick(ctx: WriteContext, transport?: NativeTransport, clock = Date.now) {
  if (!nativeIngestionConfigured(ctx)) return { authenticated: true, enabled: false, outcome: 'disabled' };
  const job = await claim(ctx, clock(), ctx.env.CRON_SECRET);
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

/** Manual, credential-protected capability test. Not an ingestion run, takes
 * no caller URL, writes no data, returns no headers/body and cannot be scheduled.
 * It is refused once ingestion is enabled to avoid a parallel fetch lane. */
export async function nativeFetchProbe(ctx: WriteContext, transport: NativeTransport = fetch) {
  if (nativeIngestionConfigured(ctx)) throw new DomainError('Disable ingestion before running a capability probe.', 409);
  const response = await transport('https://wordpress.org/news/feed/', {
    method: 'GET', credentials: 'omit', redirect: 'manual',
    headers: { accept: 'application/rss+xml', 'accept-encoding': 'identity' },
  });
  const boundedReadAvailable = typeof response.body?.getReader === 'function';
  await response.body?.cancel?.().catch(() => {});
  return { authenticated: true, enabled: false, status: response.status, boundedReadAvailable };
}
