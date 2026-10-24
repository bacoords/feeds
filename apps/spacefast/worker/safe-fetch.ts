import { lookup } from 'node:dns/promises';
import { request, type RequestOptions } from 'node:https';
import { isIP } from 'node:net';
import { checkServerIdentity } from 'node:tls';
import ipaddr from 'ipaddr.js';

export const MAX_FEED_BYTES = 2 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 15_000;
export const MAX_REDIRECTS = 3;

/** Codes, rather than upstream messages, avoid persisting URLs, credentials or content in errors. */
export class IngestionError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'IngestionError';
  }
}

export type Address = { address: string; family: 4 | 6 };
export type Resolver = (hostname: string) => Promise<Address[]>;
export type ResponseHeaders = Record<string, string | string[] | undefined>;
export interface PinnedRequest {
  url: URL;
  address: Address;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
}
export interface TransportResponse {
  status: number;
  headers: ResponseHeaders;
  body: AsyncIterable<Uint8Array>;
  dispose: () => void;
}
/** Injection is for deterministic tests; production never substitutes an unchecked transport. */
export type PinnedTransport = (request: PinnedRequest) => Promise<TransportResponse>;

export function validateFeedUrl(input: string): URL {
  if (input.length > 4096 || /[\u0000-\u0020\u007f\\]/.test(input)) {
    throw new IngestionError('UNSAFE_URL');
  }
  let url: URL;
  try { url = new URL(input); } catch { throw new IngestionError('UNSAFE_URL'); }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new IngestionError('UNSAFE_URL');
  }
  // URL parsing normalizes integer, hexadecimal and octal IPv4 spellings first.
  if (isIP(hostname.replace(/^\[|\]$/g, '')) || hostname.endsWith('.') || hostname.length > 253 ||
      !hostname.includes('.') || hostname.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
      /(?:^|\.)(?:localhost|local|internal|invalid|test|example|home|lan|onion)$/.test(hostname) ||
      /(?:^|\.)metadata(?:\.|$)/.test(hostname)) {
    throw new IngestionError('UNSAFE_URL');
  }
  url.hash = '';
  return url;
}

export function isPublicAddress(address: string): boolean {
  // Azure's host/metadata virtual IP is publicly numbered but not an Internet feed endpoint.
  if (!isIP(address) || address.includes('%') || address === '168.63.129.16') return false;
  try {
    const parsed = ipaddr.parse(address);
    if (parsed.range() !== 'unicast') return false;
    // Explicitly exclude IPv4-mapped, translation, transition and future IPv6 allocations.
    return parsed.kind() === 'ipv4' || parsed.match(ipaddr.parse('2000::') as ipaddr.IPv6, 3);
  } catch { return false; }
}

export const resolvePublic: Resolver = async hostname => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map(record => ({ address: record.address, family: record.family as 4 | 6 }));
};

export async function validateAndResolve(url: URL, resolver: Resolver, signal: AbortSignal): Promise<Address> {
  let addresses: Address[];
  try { addresses = await abortable(resolver(url.hostname), signal); }
  catch (error) {
    if (signal.aborted) throw new IngestionError('FETCH_TIMEOUT');
    if (error instanceof IngestionError) throw error;
    throw new IngestionError('DNS_FAILED');
  }
  if (!addresses.length || addresses.length > 64 || addresses.some(record =>
    !isPublicAddress(record.address) || isIP(record.address) !== record.family)) {
    throw new IngestionError('UNSAFE_ADDRESS');
  }
  return addresses[0]!;
}

/** Connect only to the checked IP, while SNI and certificate verification use the original hostname. */
export function pinnedRequestOptions(options: PinnedRequest): RequestOptions & { autoSelectFamily: boolean } {
  return {
    protocol: 'https:',
    hostname: options.url.hostname,
    port: 443,
    path: options.url.pathname + options.url.search,
    method: options.method,
    headers: options.headers,
    signal: options.signal,
    agent: false,
    autoSelectFamily: false,
    family: options.address.family,
    lookup: (_hostname, _options, callback) => callback(null, options.address.address, options.address.family),
    servername: options.url.hostname,
    rejectUnauthorized: true,
    checkServerIdentity: (_hostname, certificate) => checkServerIdentity(options.url.hostname, certificate),
    maxHeaderSize: 16 * 1024,
  };
}

export const nodeHttpsTransport: PinnedTransport = options => new Promise((resolve, reject) => {
  const req = request(pinnedRequestOptions(options), response => resolve({
    status: response.statusCode ?? 0,
    headers: response.headers,
    body: response,
    dispose: () => { response.destroy(); req.destroy(); },
  }));
  req.once('error', reject);
  req.end(options.body);
});

export function header(headers: ResponseHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return typeof value === 'string' ? value : undefined;
}

/** Only bounded printable header values may cross from feeds back into request headers. */
export function validatorHeader(value: unknown, maxLength = 1024): string | undefined {
  return typeof value === 'string' && value.length <= maxLength && /^[\x20-\x7e]+$/.test(value) ? value : undefined;
}

export async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new IngestionError('FETCH_TIMEOUT');
  let abort: () => void = () => {};
  const canceled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new IngestionError('FETCH_TIMEOUT'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([promise, canceled]); }
  finally { signal.removeEventListener('abort', abort); }
}

export async function readBoundedBody(response: TransportResponse, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
  const encoding = header(response.headers, 'content-encoding');
  if (encoding && encoding.toLowerCase().trim() !== 'identity') throw new IngestionError('UNSUPPORTED_ENCODING');
  const length = header(response.headers, 'content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new IngestionError('BODY_TOO_LARGE');
  const chunks: Buffer[] = [];
  let total = 0;
  const iterator = response.body[Symbol.asyncIterator]();
  while (true) {
    const part = await abortable(iterator.next(), signal);
    if (part.done) break;
    total += part.value.byteLength;
    if (total > maxBytes) throw new IngestionError('BODY_TOO_LARGE');
    chunks.push(Buffer.from(part.value));
  }
  return Buffer.concat(chunks, total);
}

export interface FetchFeedOptions {
  etag?: string | null;
  lastModified?: string | null;
  resolver?: Resolver;
  transport?: PinnedTransport;
  timeoutMs?: number;
}
export interface FeedResponse {
  status: 'success' | 'not_modified';
  body: Buffer;
  finalUrl: string;
  etag?: string;
  lastModified?: string;
}

export async function fetchFeed(input: string, options: FetchFeedOptions = {}): Promise<FeedResponse> {
  const initial = validateFeedUrl(input);
  let url = initial;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? FETCH_TIMEOUT_MS);
  const signal = controller.signal;
  const transport = options.transport ?? nodeHttpsTransport;
  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const address = await validateAndResolve(url, options.resolver ?? resolvePublic, signal);
      const headers: Record<string, string> = {
        accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9',
        'accept-encoding': 'identity',
        'user-agent': 'FeedsPrototype/0.1 (+RSS/Atom reader)',
      };
      // Do not forward validators to a different origin.
      if (url.origin === initial.origin) {
        const etag = validatorHeader(options.etag);
        const modified = validatorHeader(options.lastModified, 200);
        if (etag) headers['if-none-match'] = etag;
        if (modified) headers['if-modified-since'] = modified;
      }
      const response = await abortable(transport({ url, address, headers, method: 'GET', signal }), signal);
      try {
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          if (redirects === MAX_REDIRECTS) throw new IngestionError('TOO_MANY_REDIRECTS');
          const location = header(response.headers, 'location');
          if (!location || /[\u0000-\u0020\u007f\\]/.test(location)) throw new IngestionError('INVALID_REDIRECT');
          try { url = validateFeedUrl(new URL(location, url).href); }
          catch { throw new IngestionError('UNSAFE_REDIRECT'); }
          continue;
        }
        const metadata = {
          finalUrl: url.href,
          etag: validatorHeader(header(response.headers, 'etag')),
          lastModified: validatorHeader(header(response.headers, 'last-modified'), 200),
        };
        if (response.status === 304) {
          if (!headers['if-none-match'] && !headers['if-modified-since']) throw new IngestionError('UNEXPECTED_NOT_MODIFIED');
          return { status: 'not_modified', body: Buffer.alloc(0), ...metadata };
        }
        if (response.status !== 200) throw new IngestionError('UPSTREAM_STATUS');
        return { status: 'success', body: await readBoundedBody(response, MAX_FEED_BYTES, signal), ...metadata };
      } finally { response.dispose(); }
    }
    throw new IngestionError('TOO_MANY_REDIRECTS');
  } catch (error) {
    if (signal.aborted) throw new IngestionError('FETCH_TIMEOUT');
    if (error instanceof IngestionError) throw error;
    throw new IngestionError('FETCH_FAILED');
  } finally { clearTimeout(timeout); controller.abort(); }
}
