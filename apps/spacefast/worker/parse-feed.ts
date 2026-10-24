import { createHash } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import sanitizeHtml from 'sanitize-html';
import { IngestionError, MAX_FEED_BYTES, validateFeedUrl } from './safe-fetch.js';
import type { NormalizedItem } from '../shared/contracts.js';

export const MAX_ITEMS = 50;
export const MAX_BODY_TEXT = 50_000;
export const MAX_TITLE = 500;
export type FeedItem = NormalizedItem;

type XmlNode = { [tag: string]: XmlNode[] | string | Record<string, string> };
const forbiddenText = new Set(['script', 'style', 'textarea', 'noscript', 'template', 'iframe', 'object', 'embed', 'svg', 'math']);
const blocks = new Set(['p', 'div', 'br', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'tr', 'section', 'article']);
const tagName = (node: XmlNode): string => Object.keys(node).find(key => key !== ':@') ?? '';
const localName = (tag: string): string => tag.split(':').at(-1)!.toLowerCase();
const children = (node: XmlNode | undefined): XmlNode[] => {
  if (!node) return [];
  const value = node[tagName(node)];
  return Array.isArray(value) ? value : [];
};
const find = (nodes: XmlNode[], name: string): XmlNode | undefined => nodes.find(node => localName(tagName(node)) === name);
const attrs = (node: XmlNode): Record<string, string> => (node[':@'] ?? {}) as Record<string, string>;

/** Decode only built-in XML and numeric references. No declared/custom entities are evaluated. */
function decodeXml(text: string): string {
  const known: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
    if (!entity.startsWith('#')) return known[entity] ?? match;
    const point = entity[1]?.toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '\ufffd';
  });
}

function rawText(nodes: XmlNode[], cdata = false, depth = 0): string {
  if (depth > 32) throw new IngestionError('XML_TOO_DEEP');
  return nodes.map(node => {
    const tag = tagName(node);
    if (tag === '#text') return cdata ? String(node[tag]) : decodeXml(String(node[tag]));
    if (forbiddenText.has(localName(tag))) return '';
    const text = rawText(children(node), tag === '#cdata', depth + 1);
    return blocks.has(localName(tag)) ? `\n${text}\n` : text;
  }).join('');
}

/** Returned text must still be rendered as text, never innerHTML. No images are retained or fetched. */
export function toPlainText(input: string, limit = MAX_BODY_TEXT): string {
  const separated = input.replace(/<\/?(?:p|div|br|li|h[1-6]|blockquote|tr|section|article)\b[^>]*>/gi, '\n');
  const sanitized = sanitizeHtml(separated, {
    allowedTags: [],
    allowedAttributes: {},
    nonTextTags: [...forbiddenText],
    nestingLimit: 32,
  });
  // sanitize-html escapes text for HTML. Decode its escaped text once for React text nodes.
  return sanitized.replace(/&(amp|lt|gt|quot|#39);/g, (_match, entity: string) =>
    ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[entity]!)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[\t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, limit);
}

function scalar(nodes: XmlNode[], name: string): string {
  return rawText(children(find(nodes, name))).trim();
}

function articleUrl(input: string, base: string): string {
  if (!input || input.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(input)) return '';
  try {
    const url = validateFeedUrl(new URL(input, base).href);
    return url.href.length <= 2048 ? url.href : '';
  } catch { return ''; }
}

function publishedDate(input: string): string {
  if (!input || input.length > 100) return '';
  const date = new Date(input);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

export function parseFeed(bytes: Uint8Array | string, sourceId: string, baseUrl: string): FeedItem[] {
  if (!sourceId || sourceId.length > 256) throw new IngestionError('INVALID_SOURCE');
  if (typeof bytes === 'string' ? Buffer.byteLength(bytes) > MAX_FEED_BYTES : bytes.byteLength > MAX_FEED_BYTES) {
    throw new IngestionError('BODY_TOO_LARGE');
  }
  let xml: string;
  try { xml = typeof bytes === 'string' ? bytes : new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new IngestionError('UNSUPPORTED_XML_ENCODING'); }
  if (xml.includes('\u0000')) throw new IngestionError('INVALID_XML');
  // Check before parsing/validation, including declarations concealed in CDATA. Fail closed.
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new IngestionError('FORBIDDEN_XML_DECLARATION');
  const encoding = xml.match(/^\s*<\?xml\b[^>]*encoding\s*=\s*['"]([^'"]+)['"]/i)?.[1];
  if (encoding && !/^(?:utf-8|utf8|us-ascii)$/i.test(encoding)) throw new IngestionError('UNSUPPORTED_XML_ENCODING');
  if (XMLValidator.validate(xml) !== true) throw new IngestionError('INVALID_XML');
  let parsed: XmlNode[];
  try {
    parsed = new XMLParser({
      preserveOrder: true, ignoreAttributes: false, cdataPropName: '#cdata',
      parseTagValue: false, parseAttributeValue: false, trimValues: false,
      processEntities: false, htmlEntities: false, ignoreDeclaration: true,
      ignorePiTags: true, maxNestedTags: 32,
    }).parse(xml) as XmlNode[];
  } catch { throw new IngestionError('INVALID_XML'); }
  const root = parsed[0];
  const type = root ? localName(tagName(root)) : '';
  let entries: XmlNode[];
  if (type === 'feed') entries = children(root).filter(node => localName(tagName(node)) === 'entry');
  else if (type === 'rss') {
    const channel = find(children(root), 'channel');
    if (!channel) throw new IngestionError('UNSUPPORTED_FEED');
    entries = children(channel).filter(node => localName(tagName(node)) === 'item');
  } else if (type === 'rdf') entries = children(root).filter(node => localName(tagName(node)) === 'item');
  else throw new IngestionError('UNSUPPORTED_FEED');

  const seen = new Set<string>();
  const items: FeedItem[] = [];
  for (const entry of entries) {
    if (items.length === MAX_ITEMS) break;
    const nodes = children(entry);
    const title = toPlainText(scalar(nodes, 'title'), MAX_TITLE) || 'Untitled article';
    let link = scalar(nodes, 'link');
    if (type === 'feed') {
      const links = nodes.filter(node => localName(tagName(node)) === 'link');
      const alternate = links.find(node => !attrs(node)['@_rel'] || attrs(node)['@_rel'] === 'alternate');
      link = alternate ? decodeXml(attrs(alternate)['@_href'] ?? '') : '';
    }
    const url = articleUrl(link, baseUrl);
    const bodyText = toPlainText(scalar(nodes, 'encoded') || scalar(nodes, 'content') || scalar(nodes, 'description') || scalar(nodes, 'summary'));
    const authorNode = find(nodes, 'author');
    const author = toPlainText(scalar(children(authorNode), 'name') || scalar(nodes, 'creator') || scalar(nodes, 'author'), 200);
    const publishedAt = publishedDate(scalar(nodes, 'pubdate') || scalar(nodes, 'published') || scalar(nodes, 'updated') || scalar(nodes, 'date'));
    const guid = scalar(nodes, 'guid') || scalar(nodes, 'id') || decodeXml(attrs(entry)['@_rdf:about'] ?? '');
    const identity = guid ? `id:${guid}` : url ? `url:${url}` : `content:${title}\0${publishedAt ?? ''}\0${bodyText}`;
    const key = `item_${createHash('sha256').update(sourceId).update('\0').update(identity).digest('hex')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ key, title, url, bodyText, author, publishedAt });
  }
  return items;
}
