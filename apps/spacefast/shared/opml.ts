import { Parser, XMLValidator } from './vendor/feed-parsers.js';

export const SOURCE_LIMIT = 25;
export const OPML_MAX_BYTES = 262_144;
export const OPML_MAX_FEEDS = 500;
const MAX_DEPTH = 24;
const MAX_NODES = 5_000;
const MAX_ATTRIBUTES = 32;
const XML_DECLARATION = /^<\?xml\s+version\s*=\s*(?:"1\.0"|'1\.0')(?:\s+encoding\s*=\s*(?:"[A-Za-z][A-Za-z0-9._-]*"|'[A-Za-z][A-Za-z0-9._-]*'))?(?:\s+standalone\s*=\s*(?:"(?:yes|no)"|'(?:yes|no)'))?\s*\?>$/;

export type OpmlEntry = {
  id: string;
  title: string;
  url: string;
  folder: string;
  error: string | null;
  duplicateOf: string | null;
};
export type OpmlPreview = { entries: OpmlEntry[]; duplicateCount: number; invalidCount: number };
export type OpmlImportInput = { xml: string; selectedIds: string[] };
export type OpmlImportResult = { imported: number; existing: number; sourceIds: string[] };

export class OpmlParseError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'OpmlParseError'; }
}
const fail = (code: string, message = 'This file is not valid OPML XML.'): never => { throw new OpmlParseError(code, message); };

/** Shared with manual add: validation is not a substitute for fetch-time SSRF defenses. */
export function normalizeFeedUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || !value.trim()) throw new Error('Enter an HTTPS feed URL.');
  const raw = value.trim();
  if (/[\u0000-\u0020\u007f\\]/.test(raw)) throw new Error('Use a feed URL without spaces, control characters or backslashes.');
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Enter an HTTPS feed URL.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !host.includes('.') || host.endsWith('.') || /(^|\.)(localhost|local|internal|test|invalid)$/.test(host) || host === 'metadata.google.internal' || /^[\d.:[\]]+$/.test(host)) throw new Error('Use a public HTTPS hostname without credentials or a custom port.');
  url.hash = '';
  if (url.href.length > 2048) throw new Error('Feed URLs must be at most 2,048 characters.');
  return url.href;
}

/** No DOM, Node, TextEncoder, network or other host-specific APIs are used. */
function validateInput(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) fail('INVALID_XML', 'Choose a non-empty OPML file.');
  const xml = value as string;
  if (xml.length > OPML_MAX_BYTES) fail('TOO_LARGE', 'OPML files must be at most 256 KiB.');
  let bytes = 0;
  for (let index = 0; index < xml.length; index++) {
    const point = xml.charCodeAt(index);
    if (point <= 0x7f) bytes++;
    else if (point <= 0x7ff) bytes += 2;
    else if (point >= 0xd800 && point <= 0xdbff) {
      const next = xml.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail('ENCODING', 'Save the OPML file using UTF-8 encoding.');
      bytes += 4;
    } else if (point >= 0xdc00 && point <= 0xdfff) fail('ENCODING', 'Save the OPML file using UTF-8 encoding.');
    else bytes += 3;
    if (bytes > OPML_MAX_BYTES) fail('TOO_LARGE', 'OPML files must be at most 256 KiB.');
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(xml)) fail('INVALID_XML');
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) fail('DECLARATION', 'OPML files with DTD or entity declarations are not supported.');
  const normalized = xml.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');
  const declaration = normalized.match(/^<\?xml\s+([^?]*)\?>/);
  const encoding = declaration?.[1].match(/\bencoding\s*=\s*(['"])([^'"]+)\1/)?.[2];
  if (encoding && (!/^(?:utf-8|utf8|us-ascii)$/i.test(encoding) || (/^us-ascii$/i.test(encoding) && /[^\x00-\x7f]/.test(normalized)))) fail('ENCODING', 'Save the OPML file using UTF-8 encoding.');
  return normalized;
}

function decodeXml(value: string): string {
  const known: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return value.replace(/&(?:([^&;\s]{1,32});)?/g, (_match, entity: string | undefined) => {
    if (!entity) return fail('ENTITY', 'This OPML file contains an invalid XML entity.');
    if (Object.hasOwn(known, entity)) return known[entity];
    if (!/^(?:#\d{1,10}|#x[\da-fA-F]{1,8})$/.test(entity)) return fail('ENTITY', 'This OPML file contains an unsupported XML entity.');
    const point = entity.startsWith('#x') ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (!(point === 9 || point === 10 || point === 13 || (point >= 0x20 && point <= 0xd7ff) || (point >= 0xe000 && point <= 0xfffd) || (point >= 0x10000 && point <= 0x10ffff))) return fail('ENTITY', 'This OPML file contains an invalid XML entity.');
    return String.fromCodePoint(point);
  });
}

type XmlElement = { name: string; attributes: Record<string, string>; children: XmlElement[] };

/** Maintained validator/tokenizer, with bounded events before full syntax validation. */
function parseXml(xml: string): XmlElement {
  const roots: XmlElement[] = [];
  const stack: XmlElement[] = [];
  const attributes = new Map<string, string>();
  let nodeCount = 0;
  let inCdata = false;
  const countNode = () => { if (++nodeCount > MAX_NODES) fail('COMPLEXITY', 'This OPML file has too many XML elements.'); };
  const parser = new Parser({
    onattribute(name, value, quote) {
      // Case-folded aliases must not let preview and import disagree about xmlUrl.
      const key = name.toLowerCase();
      if (attributes.has(key) || !quote || value.includes('<')) fail('INVALID_XML');
      if (attributes.size >= MAX_ATTRIBUTES) fail('COMPLEXITY', 'This OPML file has too many attributes per element.');
      attributes.set(key, decodeXml(value));
    },
    onopentag(name) {
      if (stack.length >= MAX_DEPTH) fail('DEPTH', 'This OPML file has too many nested folders or XML elements.');
      countNode();
      const node: XmlElement = { name, attributes: Object.fromEntries(attributes), children: [] };
      attributes.clear();
      if (stack.length) stack[stack.length - 1].children.push(node);
      else roots.push(node);
      if (roots.length > 1) fail('INVALID_XML');
      stack.push(node);
    },
    onclosetag(name, implied) {
      if (implied && !xml.slice(parser.startIndex, parser.endIndex + 1).endsWith('/>')) fail('INVALID_XML');
      if (stack.pop()?.name !== name) fail('INVALID_XML');
    },
    ontext(value) {
      if (!inCdata && (value.includes('<') || value.includes(']]>'))) fail('INVALID_XML');
      if (!stack.length) { if (value.trim()) fail('INVALID_XML'); return; }
      countNode();
      if (!inCdata) decodeXml(value);
    },
    oncomment(value) {
      countNode();
      if (value.includes('--') || value.endsWith('-') || !xml.slice(parser.startIndex, parser.endIndex + 1).endsWith('-->')) fail('INVALID_XML');
    },
    oncdatastart() {
      if (!stack.length || !xml.slice(parser.startIndex, parser.endIndex + 1).endsWith(']]>')) fail('INVALID_XML');
      inCdata = true;
    },
    oncdataend() { inCdata = false; },
    onprocessinginstruction(name) {
      countNode();
      const raw = xml.slice(parser.startIndex, parser.endIndex + 2);
      if (!name.startsWith('?') || XMLValidator.validate(`<${name.slice(1)}/>`) !== true || !raw.endsWith('?>')) fail('INVALID_XML');
      if (name.toLowerCase() === '?xml' && (name !== '?xml' || parser.startIndex > 0 || !XML_DECLARATION.test(raw))) fail('INVALID_XML');
    },
    onerror() { fail('INVALID_XML'); },
  }, { xmlMode: true, decodeEntities: false, lowerCaseTags: false, lowerCaseAttributeNames: false });
  parser.end(xml);
  if (stack.length || roots.length !== 1 || XMLValidator.validate(xml) !== true) fail('INVALID_XML');
  return roots[0];
}

/** Preview every candidate; never truncate, fetch URLs, or silently upgrade HTTP feeds. */
export function parseOpml(input: string): OpmlPreview {
  let root: XmlElement;
  try { root = parseXml(validateInput(input)); }
  catch (error) { if (error instanceof OpmlParseError) throw error; return fail('INVALID_XML'); }
  if (root.name.toLowerCase() !== 'opml') fail('FORMAT', 'Choose an OPML subscriptions file, not an RSS or Atom feed.');
  const bodies = root.children.filter(node => node.name.toLowerCase() === 'body');
  if (bodies.length !== 1) fail('FORMAT', 'The OPML file must contain exactly one body.');
  const entries: OpmlEntry[] = [];
  const seen = new Map<string, string>();
  const visit = (nodes: XmlElement[], folders: string[]) => {
    for (const node of nodes) {
      if (node.name.toLowerCase() !== 'outline') fail('FORMAT', 'The OPML body may contain only feed or folder outlines.');
      const attrs = node.attributes;
      const label = attrs.title?.trim() || attrs.text?.trim() || '';
      const feed = Object.hasOwn(attrs, 'xmlurl') || /^(rss|atom)$/i.test(attrs.type ?? '');
      if (!feed) {
        visit(node.children, label ? [...folders, label] : folders);
        continue;
      }
      if (entries.length >= OPML_MAX_FEEDS) fail('FEED_LIMIT', 'This prototype previews at most 500 feeds per OPML file. Split the file into smaller files.');
      const entry: OpmlEntry = { id: `opml-${entries.length + 1}`, title: label, url: (attrs.xmlurl ?? '').trim(), folder: folders.join(' / '), error: null, duplicateOf: null };
      try { entry.url = normalizeFeedUrl(attrs.xmlurl); }
      catch (error) { entry.error = error instanceof Error ? error.message : 'Enter a public HTTPS feed URL.'; }
      if (!entry.title && !entry.error) entry.title = new URL(entry.url).hostname;
      if (!entry.title) entry.title = 'Untitled feed';
      if (entry.title.length > 200) entry.error = 'Feed titles must be at most 200 characters.';
      if (entry.folder.length > 100) entry.error = 'Combined folder paths must be at most 100 characters.';
      if (/[\u0000-\u001f\u007f]/.test(entry.title + entry.folder)) entry.error = 'Feed titles and folder names cannot contain control characters.';
      if (!entry.error) {
        entry.duplicateOf = seen.get(entry.url) ?? null;
        if (!entry.duplicateOf) seen.set(entry.url, entry.id);
      }
      entries.push(entry);
      // A feed is not a folder, even if an exporter nests outlines below it.
      visit(node.children, folders);
    }
  };
  visit(bodies[0].children, []);
  if (!entries.length) fail('EMPTY', 'No feed subscriptions were found in this OPML file.');
  return { entries, duplicateCount: entries.filter(entry => entry.duplicateOf !== null).length, invalidCount: entries.filter(entry => entry.error !== null).length };
}
