import { Parser, XMLValidator } from './vendor/feed-parsers.js';
import { safeUrl } from './domain.js';
import type { NormalizedItem } from '../shared/contracts.js';

export const NATIVE_MAX_FEED_BYTES = 262_144;
export const NATIVE_MAX_ITEMS = 20;
export const NATIVE_MAX_BODY_TEXT = 50_000;
const MAX_DEPTH = 32;
const MAX_NODES = 10_000;
const MAX_ATTRIBUTES = 64;
const XML_DECLARATION = /^<\?xml\s+version\s*=\s*(?:"1\.0"|'1\.0')(?:\s+encoding\s*=\s*(?:"[A-Za-z][A-Za-z0-9._-]*"|'[A-Za-z][A-Za-z0-9._-]*'))?(?:\s+standalone\s*=\s*(?:"(?:yes|no)"|'(?:yes|no)'))?\s*\?>$/;
const forbiddenText = new Set(['script', 'style', 'textarea', 'noscript', 'template', 'iframe', 'object', 'embed', 'svg', 'math']);
const blocks = new Set(['p', 'div', 'br', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'tr', 'section', 'article']);
const localName = (name: string): string => name.split(':').at(-1)!.toLowerCase();
const fail = (code: string): never => { throw new NativeParseError(code); };

export class NativeParseError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'NativeParseError'; }
}

/** Counts UTF-8 without Buffer/TextEncoder; unpaired surrogates cannot be valid UTF-8 input. */
export function utf8ByteLength(input: string): number {
  let bytes = 0;
  for (let index = 0; index < input.length; index++) {
    const point = input.charCodeAt(index);
    if (point <= 0x7f) bytes++;
    else if (point <= 0x7ff) bytes += 2;
    else if (point >= 0xd800 && point <= 0xdbff) {
      const next = input.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail('UNSUPPORTED_XML_ENCODING');
      bytes += 4;
    } else if (point >= 0xdc00 && point <= 0xdfff) fail('UNSUPPORTED_XML_ENCODING');
    else bytes += 3;
  }
  return bytes;
}

function validXmlPoint(point: number): boolean {
  return point === 9 || point === 10 || point === 13 ||
    (point >= 0x20 && point <= 0xd7ff) || (point >= 0xe000 && point <= 0xfffd) ||
    (point >= 0x10000 && point <= 0x10ffff);
}

/** Only XML's five predefined references and valid numeric references are accepted. */
function decodeXml(input: string): string {
  const known: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return input.replace(/&(?:([^&;\s]{1,32});)?/g, (_match, entity: string | undefined) => {
    if (!entity) return fail('INVALID_XML_ENTITY');
    if (Object.hasOwn(known, entity)) return known[entity];
    if (!/^(?:#\d{1,10}|#x[\da-fA-F]{1,8})$/.test(entity)) return fail('INVALID_XML_ENTITY');
    const point = entity.startsWith('#x') ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (!validXmlPoint(point)) return fail('INVALID_XML_ENTITY');
    return String.fromCodePoint(point);
  });
}

type XmlElement = { name: string; attributes: Record<string, string>; children: Array<XmlElement | string> };
const elements = (element: XmlElement | undefined): XmlElement[] =>
  element?.children.filter((child): child is XmlElement => typeof child !== 'string') ?? [];
const find = (element: XmlElement | undefined, name: string): XmlElement | undefined =>
  elements(element).find(child => localName(child.name) === name);

/** XMLValidator validates syntax; htmlparser2 tokenizes. The adapter only bounds/collects events. */
function parseXml(xml: string): XmlElement {
  const roots: XmlElement[] = [];
  const stack: XmlElement[] = [];
  let inCdata = false;
  let nodeCount = 0;
  const pendingAttributes = new Map<string, string>();
  const parser = new Parser({
    onattribute(name, value, quote) {
      if (pendingAttributes.has(name)) fail('INVALID_XML');
      if (pendingAttributes.size >= MAX_ATTRIBUTES) fail('XML_TOO_COMPLEX');
      if (!quote || value.includes('<')) fail('INVALID_XML');
      // Collect our own map so special names such as __proto__ remain ordinary data.
      pendingAttributes.set(name, decodeXml(value));
    },
    onopentag(name) {
      if (stack.length >= MAX_DEPTH) fail('XML_TOO_DEEP');
      if (++nodeCount > MAX_NODES) fail('XML_TOO_COMPLEX');
      const node: XmlElement = { name, attributes: Object.fromEntries(pendingAttributes), children: [] };
      pendingAttributes.clear();
      if (stack.length) stack[stack.length - 1].children.push(node);
      else roots.push(node);
      if (roots.length > 1) fail('INVALID_XML');
      stack.push(node);
    },
    onclosetag(name, implied) {
      // htmlparser2 can auto-close malformed input; never accept its repair in XML mode.
      if (implied && !xml.slice(parser.startIndex, parser.endIndex + 1).endsWith('/>')) fail('INVALID_XML');
      if (stack.pop()?.name !== name) fail('INVALID_XML');
    },
    ontext(value) {
      if (!inCdata && (value.includes('<') || value.includes(']]>'))) fail('INVALID_XML');
      if (!stack.length) { if (value.trim()) fail('INVALID_XML'); return; }
      if (++nodeCount > MAX_NODES) fail('XML_TOO_COMPLEX');
      stack[stack.length - 1].children.push(inCdata ? value : decodeXml(value));
    },
    oncomment(value) {
      if (value.includes('--') || value.endsWith('-') || !xml.slice(parser.startIndex, parser.endIndex + 1).endsWith('-->')) fail('INVALID_XML');
    },
    oncdatastart() {
      if (!stack.length || !xml.slice(parser.startIndex, parser.endIndex + 1).endsWith(']]>')) fail('INVALID_XML');
      inCdata = true;
    },
    oncdataend() { inCdata = false; },
    onprocessinginstruction(name) {
      // In htmlparser2 12, a PI endIndex points at '?' rather than the final '>'.
      const raw = xml.slice(parser.startIndex, parser.endIndex + 2);
      if (!name.startsWith('?') || XMLValidator.validate(`<${name.slice(1)}/>`) !== true || !raw.endsWith('?>')) fail('INVALID_XML');
      if (name.toLowerCase() === '?xml' && (name !== '?xml' || parser.startIndex > 0 || !XML_DECLARATION.test(raw))) fail('INVALID_XML');
    },
    onerror() { fail('INVALID_XML'); },
  }, { xmlMode: true, decodeEntities: false, lowerCaseTags: false, lowerCaseAttributeNames: false });
  parser.end(xml);
  if (stack.length || roots.length !== 1) fail('INVALID_XML');
  // Token bounds and rejection of malformed attributes run first, before full validation.
  if (XMLValidator.validate(xml) !== true) fail('INVALID_XML');
  return roots[0];
}

function rawText(element: XmlElement | undefined): string {
  if (!element || forbiddenText.has(localName(element.name))) return '';
  return element.children.map(child => {
    if (typeof child === 'string') return child;
    const value = rawText(child);
    return blocks.has(localName(child.name)) ? `\n${value}\n` : value;
  }).join('');
}

/** Text only. No HTML, attributes, remote media or network operations are retained. */
export function nativePlainText(input: string, limit = NATIVE_MAX_BODY_TEXT): string {
  const stack: boolean[] = [];
  let suppressed = false;
  const pieces: string[] = [];
  const parser = new Parser({
    onopentag(name) {
      if (stack.length >= MAX_DEPTH) fail('CONTENT_TOO_DEEP');
      stack.push(suppressed);
      suppressed ||= forbiddenText.has(localName(name));
      if (!suppressed && blocks.has(localName(name))) pieces.push('\n');
    },
    onclosetag(name) {
      if (!suppressed && localName(name) !== 'br' && blocks.has(localName(name))) pieces.push('\n');
      suppressed = stack.pop() ?? false;
    },
    ontext(value) { if (!suppressed) pieces.push(value); },
    onerror() { fail('INVALID_CONTENT'); },
  }, { decodeEntities: true, xmlMode: false });
  parser.end(input);
  const output = pieces.join('').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\r\n?/g, '\n').replace(/[\t ]+/g, ' ').replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, Math.max(0, limit));
  // Do not create invalid Unicode by truncating between a surrogate pair.
  const last = output.charCodeAt(output.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? output.slice(0, -1) : output;
}

function scalar(element: XmlElement | undefined, name: string): string { return rawText(find(element, name)).trim(); }
function articleUrl(input: string, base: string): string {
  if (!input || input.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(input)) return '';
  try {
    const result = safeUrl(new URL(input, base).href);
    return result.length <= 2048 ? result : '';
  } catch { return ''; }
}
function publishedDate(input: string): string {
  if (!input || input.length > 100) return '';
  const date = new Date(input);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

/** Caller supplies decoded UTF-8 and ctx.crypto.sha256; this module assumes no host APIs. */
export async function parseNativeFeed(
  xml: string, sourceId: string, baseUrl: string, sha256: (value: string) => Promise<string>,
): Promise<NormalizedItem[]> {
  if (typeof sourceId !== 'string' || !sourceId || sourceId.length > 256 || sourceId.includes('\0')) fail('INVALID_SOURCE');
  if (typeof xml !== 'string') fail('UNSUPPORTED_XML_ENCODING');
  if (xml.length > NATIVE_MAX_FEED_BYTES || utf8ByteLength(xml) > NATIVE_MAX_FEED_BYTES) fail('BODY_TOO_LARGE');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(xml)) fail('INVALID_XML');
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) fail('FORBIDDEN_XML_DECLARATION');
  xml = xml.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');
  const declaration = xml.match(/^<\?xml\s+([^?]*)\?>/);
  if (declaration) {
    const encoding = declaration[1].match(/\bencoding\s*=\s*(['"])([^'"]+)\1/)?.[2];
    if (encoding && !/^(?:utf-8|utf8|us-ascii)$/i.test(encoding)) fail('UNSUPPORTED_XML_ENCODING');
    if (encoding && /^us-ascii$/i.test(encoding) && /[^\x00-\x7f]/.test(xml)) fail('UNSUPPORTED_XML_ENCODING');
  }
  let root: XmlElement;
  try { root = parseXml(xml); }
  catch (error) { if (error instanceof NativeParseError) throw error; return fail('INVALID_XML'); }
  const type = localName(root.name);
  let entries: XmlElement[];
  if (type === 'feed') entries = elements(root).filter(node => localName(node.name) === 'entry');
  else if (type === 'rss') {
    const channel = find(root, 'channel');
    if (!channel) fail('UNSUPPORTED_FEED');
    entries = elements(channel).filter(node => localName(node.name) === 'item');
  } else if (type === 'rdf') entries = elements(root).filter(node => localName(node.name) === 'item');
  else return fail('UNSUPPORTED_FEED');

  const seen = new Set<string>();
  const items: NormalizedItem[] = [];
  for (const entry of entries) {
    if (items.length >= NATIVE_MAX_ITEMS) break;
    const title = nativePlainText(scalar(entry, 'title'), 500) || 'Untitled article';
    let link = scalar(entry, 'link');
    if (type === 'feed') {
      const links = elements(entry).filter(node => localName(node.name) === 'link');
      const alternate = links.find(node => !node.attributes.rel || node.attributes.rel === 'alternate');
      link = alternate?.attributes.href ?? '';
    }
    const url = articleUrl(link, baseUrl);
    const bodyText = nativePlainText(scalar(entry, 'encoded') || scalar(entry, 'content') || scalar(entry, 'description') || scalar(entry, 'summary'));
    const author = nativePlainText(scalar(find(entry, 'author'), 'name') || scalar(entry, 'creator') || scalar(entry, 'author'), 200);
    const publishedAt = publishedDate(scalar(entry, 'pubdate') || scalar(entry, 'published') || scalar(entry, 'updated') || scalar(entry, 'date'));
    const guid = scalar(entry, 'guid') || scalar(entry, 'id') || entry.attributes['rdf:about'] || '';
    if (guid.length > 4096) fail('INVALID_ITEM_ID');
    const identity = guid ? `id:${guid}` : url ? `url:${url}` : `content:${title}\0${publishedAt}\0${bodyText}`;
    // Deduplicate before hashing, so duplicate entries cannot multiply crypto host calls.
    if (seen.has(identity)) continue;
    seen.add(identity);
    const digest = await sha256(`${sourceId}\0${identity}`);
    if (!/^[a-f0-9]{64}$/.test(digest)) fail('INVALID_HASH');
    items.push({ key: `item_${digest}`, title, url, bodyText, author, publishedAt });
  }
  return items;
}
