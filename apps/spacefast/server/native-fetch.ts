// Spacefast's host, not this JavaScript, performs DNS pinning and blocks private
// ranges/metadata on every redirect (official common 0.8.0 egress contract).
// Never substitute a generic server fetch without those host guarantees.
export const NATIVE_BODY_LIMIT = 262_144;
export class NativeFetchError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'NativeFetchError'; }
}
type Reader = { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<unknown> };
export type NativeResponse = {
  status: number; url?: string; redirected?: boolean;
  headers: { get(name: string): string | null };
  body?: { getReader(): Reader; cancel?(): Promise<unknown> } | null;
};
export type NativeTransport = (url: string, init: RequestInit) => Promise<NativeResponse>;

export function nativeFeedUrl(input: string): URL {
  if (typeof input !== 'string' || input.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(input)) throw new NativeFetchError('UNSAFE_URL');
  let url: URL;
  try { url = new URL(input); } catch { throw new NativeFetchError('UNSAFE_URL'); }
  const host = url.hostname.toLowerCase();
  const labels = host.split('.');
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      host.length > 253 || labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
      labels.every(label => /^(?:\d+|0x[0-9a-f]+)$/.test(label)) ||
      /(?:^|\.)(?:localhost|local|internal|invalid|test|example|home|lan|onion)$/.test(host) ||
      /(?:^|\.)metadata(?:\.|$)/.test(host)) throw new NativeFetchError('UNSAFE_URL');
  url.hash = '';
  return url;
}
const validator = (value: unknown, max = 1024) => typeof value === 'string' && value.length <= max && /^[\x20-\x7e]+$/.test(value) ? value : undefined;
async function discard(response: NativeResponse) { await response.body?.cancel?.().catch(() => {}); }

/** Strict UTF-8, without relying on a browser TextDecoder in QuickJS. */
export function decodeNativeUtf8(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const first = bytes[i++];
    let point: number, count: number, minimum: number;
    if (first < 0x80) { point = first; count = 0; minimum = 0; }
    else if (first >= 0xc2 && first <= 0xdf) { point = first & 0x1f; count = 1; minimum = 0x80; }
    else if (first >= 0xe0 && first <= 0xef) { point = first & 0x0f; count = 2; minimum = 0x800; }
    else if (first >= 0xf0 && first <= 0xf4) { point = first & 7; count = 3; minimum = 0x10000; }
    else throw new NativeFetchError('INVALID_UTF8');
    if (i + count > bytes.length) throw new NativeFetchError('INVALID_UTF8');
    for (let j = 0; j < count; j++) {
      const next = bytes[i++];
      if ((next & 0xc0) !== 0x80) throw new NativeFetchError('INVALID_UTF8');
      point = (point << 6) | (next & 0x3f);
    }
    if (point < minimum || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) throw new NativeFetchError('INVALID_UTF8');
    out += String.fromCodePoint(point);
  }
  return out;
}

export async function readNativeBody(response: NativeResponse): Promise<string> {
  const encoding = response.headers.get('content-encoding');
  if (encoding && encoding.toLowerCase() !== 'identity') throw new NativeFetchError('UNSUPPORTED_ENCODING');
  const type = response.headers.get('content-type') ?? '';
  const charset = type.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1];
  if (charset && !/^(?:utf-?8|us-ascii)$/i.test(charset)) throw new NativeFetchError('UNSUPPORTED_ENCODING');
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > NATIVE_BODY_LIMIT)) throw new NativeFetchError('BODY_TOO_LARGE');
  // No text() fallback: checking a fully buffered string would not bound its
  // network read. A live capability probe must establish this API before enable.
  if (typeof response.body?.getReader !== 'function') throw new NativeFetchError('BOUNDED_READ_UNAVAILABLE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      let part;
      try { part = await reader.read(); } catch { throw new NativeFetchError('FETCH_FAILED'); }
      if (part.done) break;
      if (!(part.value instanceof Uint8Array)) throw new NativeFetchError('INVALID_RESPONSE');
      total += part.value.byteLength;
      if (total > NATIVE_BODY_LIMIT) throw new NativeFetchError('BODY_TOO_LARGE');
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (length && Number(length) !== total) throw new NativeFetchError('INVALID_RESPONSE');
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return decodeNativeUtf8(bytes);
}

export type NativeFeedResponse = { status: 'success' | 'not_modified'; xml?: string; finalUrl: string; etag?: string; lastModified?: string };
export async function fetchNativeFeed(input: string, validators: { etag?: string; lastModified?: string } = {}, transport: NativeTransport = fetch): Promise<NativeFeedResponse> {
  const initial = nativeFeedUrl(input);
  let url = initial;
  const started = Date.now();
  for (let hop = 0; hop <= 2; hop++) {
    if (Date.now() - started > 4000) throw new NativeFetchError('FETCH_BUDGET');
    const headers: Record<string, string> = { accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9', 'accept-encoding': 'identity' };
    if (url.origin === initial.origin) {
      const etag = validator(validators.etag), modified = validator(validators.lastModified, 200);
      if (etag) headers['if-none-match'] = etag;
      if (modified) headers['if-modified-since'] = modified;
    }
    let response: NativeResponse;
    try { response = await transport(url.href, { method: 'GET', headers, redirect: 'manual', credentials: 'omit' }); }
    catch { throw new NativeFetchError('FETCH_FAILED'); }
    if (response.redirected || (response.url && nativeFeedUrl(response.url).href !== url.href)) {
      await discard(response);
      throw new NativeFetchError('UNEXPECTED_REDIRECT');
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await discard(response);
      const location = response.headers.get('location');
      if (hop === 2 || !location) throw new NativeFetchError('REDIRECT_LIMIT');
      try { url = nativeFeedUrl(new URL(location, url).href); }
      catch { throw new NativeFetchError('UNSAFE_URL'); }
      continue;
    }
    const etag = validator(response.headers.get('etag'));
    const lastModified = validator(response.headers.get('last-modified'), 200);
    if (response.status === 304) {
      await discard(response);
      if (!headers['if-none-match'] && !headers['if-modified-since']) throw new NativeFetchError('UNEXPECTED_NOT_MODIFIED');
      return { status: 'not_modified', finalUrl: url.href, etag, lastModified };
    }
    if (response.status !== 200) { await discard(response); throw new NativeFetchError('HTTP_ERROR'); }
    try { return { status: 'success', xml: await readNativeBody(response), finalUrl: url.href, etag, lastModified }; }
    finally { await discard(response); }
  }
  throw new NativeFetchError('REDIRECT_LIMIT');
}
