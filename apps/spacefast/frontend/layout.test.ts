import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataViews, type Field } from '@wordpress/dataviews';

const stylesheet = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const dataViewsStylesheet = readFileSync(new URL('../node_modules/@wordpress/dataviews/build-style/style.css', import.meta.url), 'utf8');
const themeTokens = readFileSync(new URL('../node_modules/@wordpress/theme/prebuilt/css/design-tokens.css', import.meta.url), 'utf8');
const rules = [...stylesheet.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, selector, declarations]) => ({ selector: selector.trim(), declarations }));

function declarationsFor(selector: string): string {
  return rules.filter(rule => rule.selector === selector).map(rule => rule.declarations).join('\n');
}

test('body has no fixed minimum width that overflows a scrollbar-reduced viewport', () => {
  // Deployed QA: 321px viewport at 200% zoom had 313px of usable width.
  // A 320px body floor forced 7px of page overflow. This is a CSS source
  // regression guard, not a replacement for deployed browser layout checks.
  const bodyRules = [...stylesheet.matchAll(/(?:^|\n)body\s*\{([^}]+)\}/g)];
  assert.equal(bodyRules.length, 1, 'keep the document width policy in one body rule');
  const bodyRule = bodyRules[0][1];
  assert.match(bodyRule, /(?:^|;)\s*min-width\s*:\s*0(?:px)?\s*;/,
    'body must be able to shrink below 320px when a scrollbar consumes viewport space');
  assert.doesNotMatch(bodyRule, /(?:^|;)\s*overflow(?:-x)?\s*:\s*(?:hidden|clip)\b/,
    'fix sizing instead of masking page overflow');
});

test('DataViews actual list markup keeps the hit target separate from the article and explicit Open action', context => {
  // This checks real component markup, not layout or touch-event behavior.
  // DataViews is client-rendered; its known SSR layout-effect warning does not
  // make this structural contract a browser/hydration test.
  const originalError = console.error;
  context.mock.method(console, 'error', (...args: unknown[]) => {
    if (String(args[0]).startsWith('Warning: useLayoutEffect does nothing on the server')) return;
    originalError(...args);
  });
  type Row = { id: string; title: string };
  const fields: Field<Row>[] = [{ id: 'title', label: 'Article', render: ({ item }) => createElement('span', { className: 'article-title' }, item.title) }];
  const html = renderToStaticMarkup(createElement(DataViews<Row>, {
    data: [{ id: 'sample-1', title: 'A long sample title that must stay readable' }],
    fields,
    view: { type: 'list', page: 1, perPage: 20, fields: [], titleField: 'title' },
    onChangeView: () => {},
    paginationInfo: { totalItems: 1, totalPages: 1 },
    defaultLayouts: { list: {} },
    actions: [
      { id: 'open', label: 'Open article', isPrimary: true, callback: () => {} },
      { id: 'star', label: 'Star article', callback: () => {} },
    ],
    selection: ['sample-1'],
    onChangeSelection: () => {},
    children: createElement(DataViews.Layout),
  }));
  assert.match(html, /<div role="row" class="is-selected"/);
  assert.match(html, /<button[^>]+class="dataviews-view-list__item"[^>]*><\/button>/);
  assert.match(html, /class="dataviews-title-field dataviews-view-list__title-field"/);
  assert.match(html, /<span class="article-title">A long sample title that must stay readable<\/span>/);
  assert.match(html, /<button[^>]+primary-action-open[^>]*>Open article<\/button>/);
});

test('list hit targets never paint over sibling article text on hover or touch', () => {
  assert.match(dataViewsStylesheet, /\.dataviews-view-list \.dataviews-view-list__item\s*\{[^}]*position:\s*absolute;[^}]*z-index:\s*1;/);
  const hitTargetRules = rules.filter(rule => /\.dataviews-view-list__item(?![-\w])/.test(rule.selector));
  assert.ok(hitTargetRules.length > 0);
  for (const rule of hitTargetRules) {
    for (const [, value] of rule.declarations.matchAll(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+);/g)) {
      assert.match(value.trim(), /^(?:transparent|none)$/, `the overlay must remain transparent: ${rule.selector}`);
    }
  }
  assert.match(stylesheet, /div\[role=row\]\.is-selected \.dataviews-view-list__item-wrapper/);
  assert.doesNotMatch(stylesheet, /\.dataviews-view-list__item\.is-selected/);
});

test('mobile Open actions keep their label intact and may wrap below the article title', () => {
  const actionRule = declarationsFor('.reader-surface .dataviews-view-list .dataviews-view-list__item-actions .components-button');
  assert.match(actionRule, /white-space:\s*nowrap;/);
  assert.match(actionRule, /overflow-wrap:\s*normal;/);
  assert.match(actionRule, /min-height:\s*40px;/);
  assert.match(actionRule, /min-width:\s*40px;/);
  assert.match(declarationsFor('.reader-surface .dataviews-view-list__field-wrapper > div:has(> .dataviews-title-field)'), /flex-wrap:\s*wrap;/);
  assert.match(declarationsFor('.reader-surface .dataviews-view-list .dataviews-title-field'), /white-space:\s*normal;/);
  assert.match(stylesheet, /item-actions > :not\(:last-child\)\s*\{\s*flex-basis:\s*max-content;/);
  assert.doesNotMatch(stylesheet, /(?:^|\n)button[^{}]*\{[^}]*overflow-wrap:\s*anywhere/);
});

test('reader palette follows installed WordPress semantic tokens rather than a second dark-mode palette', () => {
  for (const alias of ['paper', 'canvas', 'ink', 'muted', 'border', 'subtle-border', 'accent', 'accent-soft']) {
    assert.match(stylesheet, new RegExp(`--${alias}:\\s*var\\(--wpds-color-`));
  }
  const usedTokens = new Set([...stylesheet.matchAll(/var\((--wpds-[\w-]+)/g)].map(match => match[1]));
  for (const token of usedTokens) assert.ok(themeTokens.includes(`${token}:`), `${token} must exist in the installed theme`);
  assert.doesNotMatch(stylesheet, /@media\s*\(prefers-color-scheme:/, 'the ThemeProvider also supports an explicit light/dark preview choice');
  assert.doesNotMatch(stylesheet, /--(?:wpds|wp-components|wp-admin)-[\w-]+\s*:/, 'do not overwrite WordPress-owned theme tokens');
});

test('dialogs use the new scrollable content without legacy header offsets and isolate portals', () => {
  assert.match(declarationsFor('.article-drawer .app-dialog-content'), /padding:\s*0;/);
  assert.doesNotMatch(stylesheet, /components-modal__|padding-top:\s*84px/);
  assert.match(declarationsFor('.app-dialog'), /min-width:\s*0;/);
  assert.match(declarationsFor('.sidebar.mobile-sidebar'), /display:\s*flex;/);
  assert.doesNotMatch(stylesheet, /sidebar-open/);
  assert.match(declarationsFor('#root'), /isolation:\s*isolate;/);
  assert.match(declarationsFor('body'), /position:\s*relative;/);
});
