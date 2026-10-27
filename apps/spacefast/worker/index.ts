import type { WorkerResult } from '../shared/contracts.js';
import { parseFeed } from './parse-feed.js';
import {
  abortable, fetchFeed, IngestionError, nodeHttpsTransport, readBoundedBody,
  resolvePublic, validateAndResolve, validateFeedUrl, validatorHeader,
  type FetchFeedOptions, type PinnedTransport, type Resolver,
} from './safe-fetch.js';

export interface WorkerConfig { appUrl: string; secret: string }
export interface Claim {
  jobId: string; leaseToken: string; sourceId: string; url: string;
  etag?: string; lastModified?: string;
}
export interface WorkerApi {
  claim: () => Promise<Claim | null>;
  result: (result: WorkerResult) => Promise<void>;
}

// Below the API's 1,000,000-character cap even for escaped/multibyte content.
export const MAX_RESULT_BYTES = 750_000;

/** Keep all normalized item identities, reducing body excerpts to fit the whole wire payload. */
export function fitResultToBudget(result: WorkerResult): WorkerResult {
  if (Buffer.byteLength(JSON.stringify(result)) <= MAX_RESULT_BYTES) return result;
  const output = { ...result, items: result.items?.map(item => ({ ...item, bodyText: '' })) };
  let remaining = MAX_RESULT_BYTES - Buffer.byteLength(JSON.stringify(output));
  if (remaining < 0) throw new IngestionError('RESULT_TOO_LARGE');
  for (const [index, item] of (output.items ?? []).entries()) {
    const original = result.items![index]!.bodyText;
    const budget = Math.floor(remaining / (output.items!.length - index));
    let low = 0;
    let high = original.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (Buffer.byteLength(JSON.stringify(original.slice(0, mid))) - 2 <= budget) low = mid;
      else high = mid - 1;
    }
    // Avoid cutting a UTF-16 surrogate pair in half.
    if (low > 0 && /[\uD800-\uDBFF]/.test(original[low - 1]!)) low--;
    item.bodyText = original.slice(0, low);
    remaining -= Buffer.byteLength(JSON.stringify(item.bodyText)) - 2;
  }
  return output;
}

export function readConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  const secret = env.FEEDS_WORKER_SECRET ?? '';
  const appUrl = env.FEEDS_APP_URL ?? '';
  if (secret.length < 32 || secret.length > 4096 || !/^[\x21-\x7e]+$/.test(secret)) throw new IngestionError('INVALID_WORKER_CONFIG');
  const url = validateFeedUrl(appUrl);
  if (url.pathname !== '/' || url.search || new URL(appUrl).hash) throw new IngestionError('INVALID_WORKER_CONFIG');
  return { appUrl: url.origin, secret };
}

function claimValue(value: unknown): Claim | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IngestionError('INVALID_CLAIM');
  const claim = value as Record<string, unknown>;
  for (const key of ['jobId', 'leaseToken', 'sourceId', 'url']) {
    const item = claim[key];
    const maxLength = key === 'url' ? 2048 : key === 'leaseToken' ? 128 : 200;
    if (typeof item !== 'string' || !item.trim() || item.length > maxLength) throw new IngestionError('INVALID_CLAIM');
  }
  return {
    jobId: claim.jobId as string, leaseToken: claim.leaseToken as string,
    sourceId: claim.sourceId as string, url: claim.url as string,
    etag: validatorHeader(claim.etag), lastModified: validatorHeader(claim.lastModified, 200),
  };
}

/** Auth stays inside this narrow client. The feed-fetch path never receives the worker secret. */
export function createWorkerApi(config: WorkerConfig, dependencies: { resolver?: Resolver; transport?: PinnedTransport; timeoutMs?: number } = {}): WorkerApi {
  // Validate injected configurations too; no production HTTP/loopback escape hatch exists.
  const checked = readConfig({ FEEDS_APP_URL: config.appUrl, FEEDS_WORKER_SECRET: config.secret });
  const post = async (path: '/api/worker/claim' | '/api/worker/result', payload: unknown): Promise<unknown> => {
    const url = new URL(path, checked.appUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? 15_000);
    const signal = controller.signal;
    try {
      const address = await validateAndResolve(url, dependencies.resolver ?? resolvePublic, signal);
      const body = JSON.stringify(payload);
      if (Buffer.byteLength(body) > MAX_RESULT_BYTES) throw new IngestionError('RESULT_TOO_LARGE');
      const response = await abortable((dependencies.transport ?? nodeHttpsTransport)({
        url, address, method: 'POST', signal, body,
        headers: {
          authorization: `Bearer ${checked.secret}`,
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(body)),
          accept: 'application/json', 'accept-encoding': 'identity',
        },
      }), signal);
      try {
        // Never follow an API redirect, even to the same origin: no credentials can leak.
        if (response.status < 200 || response.status > 299) throw new IngestionError('WORKER_API_STATUS');
        const buffer = await readBoundedBody(response, 64 * 1024, signal);
        if (!buffer.length) {
          if (path === '/api/worker/claim') throw new IngestionError('INVALID_CLAIM');
          return null;
        }
        try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)); }
        catch { throw new IngestionError('WORKER_API_RESPONSE'); }
      } finally { response.dispose(); }
    } catch (error) {
      if (error instanceof IngestionError) throw error;
      throw new IngestionError('WORKER_API_FAILED');
    } finally { clearTimeout(timeout); controller.abort(); }
  };
  return {
    claim: async () => claimValue(await post('/api/worker/claim', {})),
    result: async result => { await post('/api/worker/result', result); },
  };
}

/** One claim per call; durable retries, lease fencing and scheduling belong to Zero, not this process. */
export async function runOnce(api: WorkerApi, options: FetchFeedOptions = {}): Promise<'idle' | 'success' | 'not_modified' | 'failure'> {
  const claim = await api.claim();
  if (!claim) return 'idle';
  let result: WorkerResult;
  try {
    const feed = await fetchFeed(claim.url, { ...options, etag: claim.etag, lastModified: claim.lastModified });
    result = {
      jobId: claim.jobId, leaseToken: claim.leaseToken, status: feed.status,
      items: feed.status === 'success' ? parseFeed(feed.body, claim.sourceId, feed.finalUrl) : [],
      etag: feed.etag, lastModified: feed.lastModified,
    };
  } catch (error) {
    result = {
      jobId: claim.jobId, leaseToken: claim.leaseToken, status: 'failure', items: [],
      error: error instanceof IngestionError ? error.code : 'INGESTION_FAILED',
    };
  }
  // A failed/uncertain submission must not claim completion or immediately reclaim the same job.
  // Let its durable lease expire; the backend rejects late/stale tokens and deduplicates results.
  await api.result(fitResultToBudget(result));
  return result.status;
}
