import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import { act, createElement, Fragment, useState, type ReactNode } from 'react';
import { Window } from 'happy-dom';
import { OPML_MAX_BYTES, parseOpml, type OpmlImportInput, type OpmlImportResult } from '../shared/opml';
import type { Source } from './types';

// These are DOM-simulation tests, not browser rendering tests. They verify
// application state, native control semantics, and interrupted flows, not
// mobile geometry, touch scrolling, computed colors, or visual focus behavior.
const dom = new Window({
  url: 'https://feeds.example/?preview=sample',
  settings: {
    enableJavaScriptEvaluation: false, disableJavaScriptFileLoading: true,
    enableCSSFileLoading: false, enableImageFileLoading: false, enableIframePageLoading: false,
    navigation: { disableMainFrameNavigation: true, disableChildFrameNavigation: true, disableChildPageNavigation: true },
  },
});
const originals = new Map<string, PropertyDescriptor | undefined>();
function installGlobal(key: string, value: unknown) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLDivElement', 'HTMLButtonElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'ShadowRoot', 'Element', 'SVGElement', 'Node', 'Document', 'DocumentFragment', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'PointerEvent', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'CSS']) {
  installGlobal(key, key === 'window' ? dom : Reflect.get(dom, key));
}
for (const key of ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia']) {
  installGlobal(key, Reflect.get(dom, key).bind(dom));
}
installGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let networkAttempts = 0;
const denyNetwork = () => { networkAttempts++; throw new Error('Network access is forbidden in the synthetic UI fixture.'); };
installGlobal('fetch', denyNetwork);
Object.defineProperty(dom, 'fetch', { configurable: true, value: denyNetwork });
installGlobal('WebSocket', class { constructor() { denyNetwork(); } });
Object.defineProperty(dom, 'WebSocket', { configurable: true, value: Reflect.get(globalThis, 'WebSocket') });
Object.defineProperty(dom.XMLHttpRequest.prototype, 'open', { configurable: true, value: denyNetwork });

// Import UI packages only after the DOM exists, as their feature detection is
// intentionally browser-sensitive. No native auth/query/mutation hooks mount.
const { createRoot } = await import('react-dom/client');
const { default: ImportOpmlModal, importCandidates } = await import('./ImportOpmlModal');
const { Button, Notice, TextControl, ToggleControl } = await import('./controls');
const { AppTheme, useThemeChoice } = await import('./Theme');
const { plus } = await import('@wordpress/icons');
const { default: SamplePreview } = await import('./SamplePreview');
assert.equal(networkAttempts, 0, 'importing the standalone preview must not request account data');
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;

beforeEach(() => {
  networkAttempts = 0;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  assert.equal(networkAttempts, 0, 'synthetic UI tests must never attempt a request');
});
after(async () => {
  await dom.happyDOM.close();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

async function render(node: ReactNode) {
  await act(async () => root.render(createElement(AppTheme, null, node)));
}
function button(label: string, scope: ParentNode = document): HTMLButtonElement {
  const match = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label || item.getAttribute('aria-label') === label);
  assert.ok(match, `Expected button: ${label}`);
  return match;
}
async function click(element: HTMLElement) { await act(async () => element.click()); }
function file(text: string, name = 'subscriptions.opml') {
  const bytes = new TextEncoder().encode(text);
  return { name, size: bytes.length, arrayBuffer: async () => bytes.buffer } as File;
}
async function chooseFile(value: File | undefined) {
  const input = document.querySelector<HTMLInputElement>('#opml-file');
  assert.ok(input, 'OPML file input is present');
  Object.defineProperty(input, 'files', { configurable: true, value: value ? [value] : [] });
  await act(async () => { input.dispatchEvent(new dom.Event('change', { bubbles: true }) as unknown as Event); });
}
function source(url: string, id = 'existing'): Source {
  return { id, url, title: 'Existing source', folder: 'Saved', enabled: true, nextPollAt: 0, lastAttemptAt: 0, lastSuccessAt: 0, error: '', jobStatus: '' };
}
const xml = '<opml version="2.0"><body><outline text="Reading"><outline text="First feed" xmlUrl="https://example.com/one.xml"/><outline text="Duplicate feed" xmlUrl="https://EXAMPLE.com:443/one.xml#duplicate"/><outline text="Second feed" xmlUrl="https://example.org/two.xml"/><outline text="Invalid feed" xmlUrl="http://example.net/feed.xml"/></outline></body></opml>';
const success: OpmlImportResult = { imported: 2, existing: 0, sourceIds: ['first', 'second'] };
function modal(props: Partial<Parameters<typeof ImportOpmlModal>[0]> = {}) {
  return createElement(ImportOpmlModal, { sources: [], onClose: () => {}, onImport: async () => success, ...props });
}
function checkboxes() { return [...document.querySelectorAll<HTMLElement>('[role="checkbox"], input[type="checkbox"]')].filter(item => item.getAttribute('aria-hidden') !== 'true'); }
function isChecked(element: HTMLElement) { return element.getAttribute('aria-checked') === 'true' || (element as HTMLInputElement).checked === true; }
function isDisabled(element: HTMLElement) { return element.getAttribute('aria-disabled') === 'true' || (element as HTMLInputElement).disabled === true; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('import candidates normalize existing URLs and exclude duplicates and invalid rows without mutating inputs', () => {
  const preview = parseOpml(xml);
  const sources = [source(' https://EXAMPLE.COM:443/one.xml#old '), source('not a URL', 'malformed')];
  const unchanged = JSON.stringify({ preview, sources });
  const rows = importCandidates(preview, sources);
  assert.deepEqual(rows.map(({ existing, eligible }) => ({ existing, eligible })), [
    { existing: true, eligible: false }, { existing: true, eligible: false },
    { existing: false, eligible: true }, { existing: false, eligible: false },
  ]);
  assert.equal(rows[2].folder, 'Reading');
  assert.equal(JSON.stringify({ preview, sources }), unchanged);
});

test('candidate eligibility updates when the library changes without losing preview IDs', () => {
  const preview = parseOpml(xml);
  const before = importCandidates(preview, []);
  const after = importCandidates(preview, [source('https://example.org/two.xml')]);
  assert.deepEqual(before.filter(row => row.eligible).map(row => row.id), ['opml-1', 'opml-3']);
  assert.deepEqual(after.filter(row => row.eligible).map(row => row.id), ['opml-1']);
  assert.deepEqual(after.map(row => row.id), preview.entries.map(row => row.id));
});

test('import preview selects only new valid feeds, permits clear/reselect, and submits exact selected IDs', async () => {
  const submissions: OpmlImportInput[] = [];
  let closes = 0;
  await render(modal({ sources: [source('https://example.org/two.xml')], onClose: () => closes++, onImport: async input => { submissions.push(input); return success; } }));
  assert.equal(isDisabled(button('Import  sources')), true);
  await chooseFile(file(xml));
  const entries = checkboxes();
  assert.equal(entries.length, 4);
  assert.deepEqual(entries.map(isChecked), [true, false, false, false]);
  assert.deepEqual(entries.map(isDisabled), [false, true, true, true]);
  assert.match(document.body.textContent ?? '', /1 selected; 24 slots available/);
  await click(button('Clear selection'));
  assert.equal(isDisabled(button('Import  sources')), true);
  await click(button('Select all available'));
  assert.equal(isChecked(checkboxes()[0]), true);
  await click(button('Import 1 source'));
  assert.deepEqual(submissions, [{ xml, selectedIds: ['opml-1'] }]);
  assert.equal(closes, 1);
});

test('capacity overflow never silently selects a prefix and blocks excessive manual selection', async () => {
  const sources = Array.from({ length: 24 }, (_, index) => source(`https://example.com/existing-${index}.xml`, `source-${index}`));
  await render(modal({ sources }));
  await chooseFile(file(xml));
  assert.match(document.body.textContent ?? '', /0 selected; 1 slots available/);
  assert.equal(isDisabled(button('Select all available')), true);
  await click(checkboxes()[0]);
  assert.equal(isDisabled(button('Import 1 source')), false);
  await click(checkboxes()[2]);
  assert.equal(isDisabled(button('Import 2 sources')), true);
  assert.match(document.body.textContent ?? '', /Remove 1 selections before importing/);
  await click(checkboxes()[0]);
  assert.equal(isDisabled(button('Import 1 source')), false);
});

test('changing or cancelling a file clears stale preview selections and rejects oversize files before reading', async () => {
  await render(modal());
  await chooseFile(file(xml));
  assert.equal(isDisabled(button('Import 2 sources')), false);
  await chooseFile(undefined);
  assert.equal(document.querySelector('.opml-preview'), null);
  assert.equal(isDisabled(button('Import  sources')), true);
  let read = false;
  await chooseFile({ name: 'large.opml', size: OPML_MAX_BYTES + 1, arrayBuffer: async () => { read = true; return new ArrayBuffer(0); } } as File);
  assert.equal(read, false);
  assert.match(document.querySelector('[role="alert"]')?.textContent ?? '', /no larger than 256 KiB/);
});

test('newer file selections win over slow prior file reads', async () => {
  const oldRead = deferred<ArrayBuffer>();
  await render(modal());
  await chooseFile({ name: 'old.opml', size: 1, arrayBuffer: () => oldRead.promise } as File);
  assert.match(document.body.textContent ?? '', /Reading and validating/);
  const newXml = '<opml><body><outline text="Newest feed" xmlUrl="https://example.com/new.xml"/></body></opml>';
  await chooseFile(file(newXml, 'new.opml'));
  await act(async () => oldRead.resolve(new TextEncoder().encode(xml).buffer));
  assert.match(document.querySelector('.opml-summary')?.textContent ?? '', /new.opml/);
  assert.equal(checkboxes().length, 1);
  assert.match(document.querySelector('.opml-preview')?.textContent ?? '', /Newest feed/);
  assert.equal(isDisabled(button('Import 1 source')), false);
});

test('invalid UTF-8 and invalid XML show errors without enabling import', async () => {
  await render(modal());
  await chooseFile({ name: 'bad-encoding.opml', size: 2, arrayBuffer: async () => new Uint8Array([0xc3, 0x28]).buffer } as File);
  assert.match(document.querySelector('[role="alert"]')?.textContent ?? '', /not valid UTF-8/);
  assert.equal(isDisabled(button('Import  sources')), true);
  await chooseFile(file('<not-opml>'));
  assert.match(document.querySelector('[role="alert"]')?.textContent ?? '', /not valid OPML XML/);
  assert.equal(document.querySelector('.opml-preview'), null);
});

test('cancel and close/reopen discard an importer preview, including an outstanding read', async () => {
  const read = deferred<ArrayBuffer>();
  const imports: OpmlImportInput[] = [];
  function Harness() {
    const [open, setOpen] = useState(true);
    return createElement(Fragment, null,
      createElement('button', { onClick: () => setOpen(true) }, 'Reopen importer'),
      open && modal({ onClose: () => setOpen(false), onImport: async input => { imports.push(input); return success; } }),
    );
  }
  await render(createElement(Harness));
  await chooseFile(file(xml));
  await click(button('Cancel'));
  assert.equal(document.querySelector('[role="dialog"]'), null);
  await click(button('Reopen importer'));
  assert.equal(document.querySelector('.opml-preview'), null);
  assert.equal(isDisabled(button('Import  sources')), true);
  await chooseFile({ name: 'slow.opml', size: 1, arrayBuffer: () => read.promise } as File);
  await click(button('Close panel'));
  await act(async () => read.resolve(new TextEncoder().encode(xml).buffer));
  await click(button('Reopen importer'));
  assert.equal(document.querySelector('.opml-preview'), null);
  assert.deepEqual(imports, []);
});

test('saving disables repeat submission and cancellation, and failure preserves selection for retry', async () => {
  const save = deferred<OpmlImportResult>();
  let calls = 0;
  let closes = 0;
  await render(modal({ onClose: () => closes++, onImport: async () => { calls++; return calls === 1 ? save.promise : success; } }));
  await chooseFile(file(xml));
  await click(button('Import 2 sources'));
  assert.equal(calls, 1);
  assert.equal(isDisabled(button('Cancel')), true);
  assert.equal(document.querySelector<HTMLInputElement>('#opml-file')?.disabled, true);
  await click(button('Import 2 sources'));
  await click(button('Close panel'));
  assert.equal(calls, 1);
  assert.equal(closes, 0);
  await act(async () => save.reject(new Error('Import temporarily unavailable')));
  assert.match(document.querySelector('[role="alert"]')?.textContent ?? '', /Import temporarily unavailable/);
  assert.equal(isDisabled(button('Import 2 sources')), false);
  assert.equal(isDisabled(button('Cancel')), false);
  assert.deepEqual(checkboxes().map(isChecked), [true, false, true, false]);
  await click(button('Import 2 sources'));
  assert.equal(calls, 2);
  assert.equal(closes, 1);
});

test('WordPress UI adapters preserve button, input, switch, icon-label, link and notice semantics', async () => {
  let inputValue = '';
  let toggled = false;
  let dismissed = 0;
  await render(createElement(Fragment, null,
    createElement(Button, { variant: 'primary', disabled: true }, 'Disabled action'),
    createElement(Button, { icon: plus, label: 'Add a source' }),
    createElement(Button, { href: 'https://example.com/article', target: '_blank', rel: 'noopener noreferrer' }, 'Original article'),
    createElement(TextControl, { label: 'Source name', value: '', help: 'A readable title', onChange: value => { inputValue = value; } }),
    createElement(ToggleControl, { label: 'Enabled', checked: false, onChange: value => { toggled = value; } }),
    createElement(Notice, { status: 'error', onRemove: () => { dismissed++; }, children: 'Something went wrong' }),
  ));
  assert.equal(isDisabled(button('Disabled action')), true);
  assert.equal(button('Add a source').getAttribute('aria-label'), 'Add a source');
  const link = document.querySelector<HTMLAnchorElement>('a[href="https://example.com/article"]');
  assert.equal(link?.rel, 'noopener noreferrer');
  assert.equal(link?.target, '_blank');
  const input = document.querySelector<HTMLInputElement>('input:not([type="checkbox"]):not([type="hidden"])');
  assert.ok(input);
  const setInput = Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value')?.set;
  assert.ok(setInput);
  await act(async () => { setInput.call(input, 'My reader'); input.dispatchEvent(new dom.Event('input', { bubbles: true }) as unknown as Event); });
  assert.equal(inputValue, 'My reader');
  assert.ok(input.getAttribute('aria-describedby'));
  const toggle = document.querySelector<HTMLElement>('[role="switch"]');
  assert.ok(toggle);
  await click(toggle);
  assert.equal(toggled, true);
  assert.match(document.querySelector('[role="alert"]')?.textContent ?? '', /Something went wrong/);
  await click(button('Dismiss notice'));
  assert.equal(dismissed, 1);
});

test('theme selection propagates light/dark state and remains independent from system changes', async () => {
  function Choices() {
    const { choice, setChoice } = useThemeChoice();
    return createElement(Fragment, null,
      createElement('span', { 'data-current-choice': true }, choice),
      ...(['dark', 'light', 'system'] as const).map(value => createElement('button', { key: value, onClick: () => setChoice(value) }, value)),
    );
  }
  await render(createElement(Choices));
  await click(button('dark'));
  assert.equal(document.documentElement.dataset.feedsTheme, 'dark');
  await click(button('light'));
  assert.equal(document.documentElement.dataset.feedsTheme, 'light');
  await act(async () => { dom.happyDOM.settings.device.prefersColorScheme = 'dark'; dom.dispatchEvent(new dom.Event('resize')); });
  assert.equal(document.documentElement.dataset.feedsTheme, 'light');
  await click(button('system'));
  assert.equal(document.documentElement.dataset.feedsTheme, 'dark');
  await act(async () => { dom.happyDOM.settings.device.prefersColorScheme = 'light'; dom.dispatchEvent(new dom.Event('resize')); });
  assert.equal(document.documentElement.dataset.feedsTheme, 'light');
});


function articleRows() { return [...document.querySelectorAll<HTMLButtonElement>('.article-row')]; }
function sampleStateSelector() {
  const selector = [...document.querySelectorAll('select')].find(item => [...item.options].some(option => option.value === 'sample'));
  assert.ok(selector);
  return selector;
}
async function selectValue(selector: HTMLSelectElement, value: string) {
  await act(async () => { selector.value = value; selector.dispatchEvent(new dom.Event('change', { bubbles: true }) as unknown as Event); });
}
async function setSearch(value: string) {
  const input = document.querySelector<HTMLInputElement>('.reader-search input');
  assert.ok(input);
  const setter = Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value')?.set;
  assert.ok(setter);
  await act(async () => { setter.call(input, value); input.dispatchEvent(new dom.Event('input', { bubbles: true }) as unknown as Event); });
}

test('sample reader starts list-first with secondary UI collapsed and semantic row buttons', async () => {
  await render(createElement(SamplePreview));
  assert.equal(document.querySelector('h1')?.textContent, 'All');
  assert.match(document.querySelector('.reader-status')?.textContent ?? '', /Sample articles.*not saved/);
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(document.querySelector('.reader-search'), null);
  assert.equal(document.querySelector('.workspace-kicker, .workspace-subtitle'), null);
  const tools = document.querySelector<HTMLDetailsElement>('.sample-preview-tools');
  assert.ok(tools);
  assert.equal(tools.open, false);
  assert.ok(document.querySelector('.app-shell')!.compareDocumentPosition(tools) & Node.DOCUMENT_POSITION_FOLLOWING, 'preview controls follow the reader');
  assert.equal(articleRows().length, 40);
  for (const row of articleRows()) {
    assert.equal(row.tagName, 'BUTTON');
    assert.equal(row.tabIndex, 0, 'native button is keyboard focusable');
    assert.equal(row.getAttribute('aria-label'), row.querySelector('.article-title')?.textContent);
    assert.equal(row.querySelector('button, a'), null, 'one interactive target, without nested read/open controls');
    assert.ok(row.parentElement?.matches('li'));
  }
  assert.equal(document.querySelector('.article-list')?.tagName, 'UL');
  assert.ok(![...document.querySelectorAll('button')].some(item => /^(Open|Read)( article)?$/.test(item.textContent?.trim() ?? '')));
  assert.ok(![...document.querySelectorAll('h1, h2, button')].some(item => item.textContent?.trim() === 'Library'));
});

test('whole-row and descendant clicks open immediately and closing preserves read/star state', async () => {
  await render(createElement(SamplePreview));
  for (let attempt = 0; attempt < 2; attempt++) {
    const row = articleRows()[0];
    assert.ok(row);
    // HappyDOM validates bubbling/state, not native keyboard activation or touch scrolling.
    const target = attempt ? row.querySelector<HTMLElement>('.article-excerpt') : row;
    assert.ok(target);
    await click(target);
    const drawer = document.querySelector('[role="dialog"]');
    assert.ok(drawer, 'first click opens the reader, with no intermediate selection');
    assert.match(drawer.querySelector('.article-reading-status')?.textContent ?? '', /Unread.*Starred/);
    assert.match(drawer.querySelector('.article-content')?.textContent ?? '', /synthetic sample article 1/);
    await click(button('Close panel', drawer));
    assert.equal(document.querySelector('[role="dialog"]'), null);
  }
  assert.equal(articleRows().length, 40);
  assert.equal(networkAttempts, 0);
});

test('search is opt-in, searches article content and cancellation restores the list', async () => {
  await render(createElement(SamplePreview));
  await click(button('Search articles'));
  assert.equal(button('Search articles').getAttribute('aria-expanded'), 'true');
  await setSearch('synthetic sample article 45,');
  assert.equal(articleRows().length, 1);
  assert.match(articleRows()[0].textContent ?? '', /45\./);
  await setSearch('does-not-exist-in-the-sample');
  assert.equal(articleRows().length, 0);
  assert.match(document.querySelector('.empty-filter')?.textContent ?? '', /No articles found/);
  await click(button('Cancel', document.querySelector('.reader-search')!));
  assert.equal(document.querySelector('.reader-search'), null);
  assert.equal(articleRows().length, 40);
  await click(button('Search articles'));
  await setSearch('does-not-exist-in-the-sample');
  await click(button('Search articles'));
  assert.equal(document.querySelector('.reader-search'), null);
  assert.equal(articleRows().length, 40, 'collapsing search must not leave a hidden active query');
});

test('feed navigation, read filtering and sort work without DataViews', async () => {
  await render(createElement(SamplePreview));
  await click(button('Choose feed'));
  let dialog = document.querySelector('[role="dialog"]');
  assert.ok(dialog);
  assert.equal(dialog.querySelector('h2')?.textContent, 'Feeds');
  const star = [...dialog.querySelectorAll<HTMLElement>('.nav-item')].find(item => item.textContent?.startsWith('Starred'));
  assert.ok(star);
  await click(star);
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(document.querySelector('h1')?.textContent, 'Starred');
  assert.equal(articleRows().length, 7);
  await click(button('Reader options'));
  dialog = document.querySelector('[role="dialog"]');
  assert.ok(dialog);
  const read = [...dialog.querySelectorAll('select')].find(item => [...item.options].some(option => option.value === 'read'));
  assert.ok(read);
  await selectValue(read, 'read');
  await click(button('Done', dialog));
  assert.equal(articleRows().length, 2);
  assert.ok(articleRows().every(row => row.classList.contains('is-read')));
  await click(button('Clear filter'));
  assert.equal(articleRows().length, 7);
  const firstNewest = articleRows()[0].getAttribute('aria-label');
  await click(button('Reader options'));
  dialog = document.querySelector('[role="dialog"]');
  assert.ok(dialog);
  const sort = [...dialog.querySelectorAll('select')].find(item => [...item.options].some(option => option.value === 'oldest'));
  assert.ok(sort);
  await selectValue(sort, 'oldest');
  await click(button('Done', dialog));
  assert.notEqual(articleRows()[0].getAttribute('aria-label'), firstNewest);
  assert.match(articleRows()[0].textContent ?? '', /43\./);
});

test('show more appends articles and options route into a cancellable importer', async () => {
  await render(createElement(SamplePreview));
  await click(button('Show more articles'));
  assert.equal(articleRows().length, 45);
  assert.ok(![...document.querySelectorAll('button')].some(item => item.textContent?.trim() === 'Show more articles'));
  await click(button('Reader options'));
  await click(button('Import OPML'));
  assert.equal(document.querySelectorAll('[role="dialog"]').length, 1, 'options closes before importer opens');
  assert.ok(document.querySelector('#opml-file'));
  await click(button('Cancel'));
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(articleRows().length, 45);
});

test('isolated sample fixture renders empty/loading states and resets to synthetic articles', async () => {
  await render(createElement(SamplePreview));
  const selector = sampleStateSelector();
  await selectValue(selector, 'empty');
  assert.match(document.querySelector('.empty-library')?.textContent ?? '', /Make room for good reading/);
  await selectValue(selector, 'loading');
  assert.match(document.querySelector('.loading-state')?.textContent ?? '', /Loading articles/);
  await click(button('Reader options'));
  assert.equal(isDisabled(button('Import OPML')), true);
  await click(button('Done'));
  await click(button('Reset preview'));
  assert.equal(articleRows().length, 40);
  assert.equal(networkAttempts, 0);
});

test('sample article error remains dismissible and never mounts a native article query', async () => {
  await render(createElement(SamplePreview));
  await selectValue(sampleStateSelector(), 'error');
  await click(articleRows()[0]);
  const drawer = document.querySelector('[role="dialog"]');
  assert.ok(drawer);
  assert.match(drawer.textContent ?? '', /Sample error: this article is unavailable/);
  assert.match(drawer.textContent ?? '', /no longer available in your library/);
  await click(button('Close panel', drawer));
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(networkAttempts, 0);
});

// Synthetic PointerEvents verify the gesture state machine, not iOS physics.
async function pointer(element: Element, type: string, x: number, y: number, extra: Record<string, unknown> = {}) {
  await act(async () => { element.dispatchEvent(new dom.PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, clientX: x, clientY: y, ...extra }) as unknown as Event); });
}
async function swipe(element: Element, dx: number, dy = 0) {
  await pointer(element, 'pointerdown', 180, 150);
  await pointer(element, 'pointermove', 180 + dx, 150 + dy);
  await pointer(element, 'pointerup', 180 + dx, 150 + dy);
}
async function pointerClick(element: Element) {
  await act(async () => { element.dispatchEvent(new dom.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }) as unknown as Event); });
}

test('list swipes set read left and star right without opening or toggling existing state', async () => {
  await render(createElement(SamplePreview));
  const row = articleRows()[1];
  assert.ok(!row.classList.contains('is-read'));
  assert.equal(row.querySelector('.article-star'), null);
  await swipe(row, -90);
  await pointerClick(row);
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.ok(row.classList.contains('is-read'));
  await swipe(row, -90);
  assert.ok(row.classList.contains('is-read'));
  await swipe(row, 90);
  await pointerClick(row);
  assert.ok(row.querySelector('.article-star'));
  assert.equal(document.querySelector('[role="dialog"]'), null);
  await swipe(row, 90);
  assert.ok(row.querySelector('.article-star'), 'repeat swipe never unstars');
  await pointer(row, 'pointerdown', 180, 150);
  await pointer(row, 'pointerup', 180, 150);
  await pointerClick(row);
  assert.ok(document.querySelector('[role="dialog"]'), 'next ordinary tap still opens');
});

test('short, vertical, diagonal, reversed and canceled gestures never mutate or activate row', async () => {
  await render(createElement(SamplePreview));
  const row = articleRows()[1];
  for (const [dx, dy] of [[35, 0], [-35, 0], [10, 100], [90, 95]]) {
    await swipe(row, dx, dy);
    await pointerClick(row);
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.ok(!row.classList.contains('is-read'));
    assert.equal(row.querySelector('.article-star'), null);
  }
  await pointer(row, 'pointerdown', 180, 150);
  await pointer(row, 'pointermove', 270, 150);
  await pointer(row, 'pointermove', 190, 150);
  await pointer(row, 'pointerup', 190, 150);
  assert.equal(row.querySelector('.article-star'), null);
  await pointer(row, 'pointerdown', 180, 150);
  await pointer(row, 'pointermove', 90, 150);
  await pointer(row, 'pointercancel', 90, 150);
  await pointer(row, 'pointerup', 90, 150);
  assert.ok(!row.classList.contains('is-read'));
  assert.match(row.style.transform, /translateX\(0px\)/);
});

test('vertical lock cannot turn into a horizontal action and a second pointer cancels', async () => {
  await render(createElement(SamplePreview));
  const row = articleRows()[1];
  await pointer(row, 'pointerdown', 180, 150);
  await pointer(row, 'pointermove', 185, 180);
  await pointer(row, 'pointermove', 280, 185);
  await pointer(row, 'pointerup', 280, 185);
  assert.equal(row.querySelector('.article-star'), null);
  await pointer(row, 'pointerdown', 180, 150);
  await pointer(row, 'pointermove', 280, 150);
  await pointer(document.body, 'pointerdown', 230, 180, { pointerId: 2, isPrimary: false });
  await pointer(row, 'pointerup', 280, 150);
  await pointerClick(row);
  assert.equal(row.querySelector('.article-star'), null);
  assert.equal(document.querySelector('[role="dialog"]'), null);
});

test('screen edge gestures do not trigger app actions and keyboard click still opens', async () => {
  await render(createElement(SamplePreview));
  const row = articleRows()[1];
  await pointer(row, 'pointerdown', 8, 150);
  await pointer(row, 'pointermove', 130, 150);
  await pointer(row, 'pointerup', 130, 150);
  assert.equal(row.querySelector('.article-star'), null);
  await swipe(row, 30);
  await click(row); // detail=0 is native keyboard/programmatic activation.
  assert.ok(document.querySelector('[role="dialog"]'));
});

test('article swipe-right closes without changing state; left/vertical/control gestures do not close', async () => {
  await render(createElement(SamplePreview));
  await click(articleRows()[1]);
  const drawer = document.querySelector('[role="dialog"]');
  assert.ok(drawer);
  const content = drawer.querySelector('.article-content');
  assert.ok(content);
  await swipe(content, -100);
  assert.ok(document.querySelector('[role="dialog"]'));
  await swipe(content, 10, 100);
  assert.ok(document.querySelector('[role="dialog"]'));
  await swipe(button('Star', drawer), 100);
  assert.ok(document.querySelector('[role="dialog"]'));
  await swipe(content, 100);
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.ok(!articleRows()[1].classList.contains('is-read'));
  assert.equal(articleRows()[1].querySelector('.article-star'), null);
});

test('pending rows ignore swipe mutations and failed saves roll back optimistic state', async () => {
  const { WorkspaceView } = await import('./Workspace');
  const { createSampleDashboard } = await import('./sample-data');
  const saving = deferred<unknown>();
  let calls = 0;
  const dashboard = createSampleDashboard();
  const noOp = async () => {};
  await render(createElement(WorkspaceView, {
    displayName: 'Test', dashboard, renderDrawer: () => createElement('div', { role: 'dialog' }, 'Opened'),
    actions: { mutateArticle: async () => { calls++; return saving.promise; }, addSource: noOp, updateSource: noOp, deleteSource: noOp, refreshSource: noOp, seedDemo: noOp, importOpml: noOp, signOut: noOp },
  }));
  const row = articleRows()[1];
  await swipe(row, -100);
  assert.ok(row.classList.contains('is-read'), 'optimistic read update');
  assert.equal(row.getAttribute('aria-busy'), 'true');
  await swipe(row, 100);
  await pointerClick(row);
  assert.equal(document.querySelector('[role="dialog"]'), null, 'pending swipe cannot also open');
  assert.equal(calls, 1, 'pending gesture cannot race a second mutation');
  await act(async () => saving.reject(new Error('Save failed')));
  assert.ok(!row.classList.contains('is-read'), 'failure restores original read state');
  assert.equal(row.querySelector('.article-star'), null);
  assert.match(document.querySelector('[role="alert"]')?.textContent ?? '', /Save failed/);
});


test('release coordinates recheck threshold and direction instead of stale pointermove', async () => {
  await render(createElement(SamplePreview));
  const row = articleRows()[1];
  await pointer(row, 'pointerdown', 180, 150);
  await pointer(row, 'pointermove', 280, 150);
  await pointer(row, 'pointerup', 190, 150);
  assert.equal(row.querySelector('.article-star'), null);
  await pointer(row, 'pointerdown', 180, 150);
  await pointer(row, 'pointermove', 80, 150);
  await pointer(row, 'pointerup', 80, 290);
  assert.ok(!row.classList.contains('is-read'), 'large vertical release cancels action');
});


test('uncaptured pointer exit and window blur clear interrupted gestures', async () => {
  await render(createElement(SamplePreview));
  const row = articleRows()[1];
  await pointer(row, 'pointerdown', 180, 150, { pointerType: 'mouse' });
  await pointer(row, 'pointermove', 182, 180, { pointerType: 'mouse' });
  await pointer(row, 'pointerout', 182, 280, { pointerType: 'mouse', relatedTarget: document.body });
  await pointer(row, 'pointerdown', 180, 150);
  await pointer(row, 'pointerup', 180, 150);
  await pointerClick(row);
  assert.ok(document.querySelector('[role="dialog"]'), 'next real click opens after leaving row');
  await click(button('Close panel'));
  await pointer(row, 'pointerdown', 180, 150);
  await pointer(row, 'pointermove', 280, 150);
  await act(async () => { window.dispatchEvent(new dom.Event('blur') as unknown as Event); });
  await pointer(row, 'pointerup', 280, 150);
  assert.equal(row.querySelector('.article-star'), null);
});
