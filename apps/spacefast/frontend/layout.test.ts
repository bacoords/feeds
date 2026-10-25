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

test('sidebar unread counts stay on one line while long source titles shrink', () => {
  // Hosted v4 QA at 1165px found 23 and 11 stacked into separate digits.
  // The source button's inherited overflow-wrap:anywhere allowed the count
  // to compress. This is a sizing-contract guard, not a pixel-layout test.
  const countRule = declarationsFor('.nav-count');
  assert.match(countRule, /flex:\s*0\s+0\s+auto;/, 'count badges must not absorb negative flex space');
  assert.match(countRule, /min-width:\s*calc\(2ch\s*\+\s*8px\);/);
  assert.match(countRule, /white-space:\s*nowrap;/);
  assert.match(countRule, /overflow-wrap:\s*normal;/);
  assert.match(countRule, /font-variant-numeric:\s*tabular-nums;/);

  const titleRule = declarationsFor('.source-nav > span:nth-child(2)');
  assert.match(titleRule, /flex:\s*1\s+1\s+auto;/);
  assert.match(titleRule, /min-width:\s*0;/, 'the source title, not its count, must be allowed to shrink');
  assert.match(titleRule, /overflow:\s*hidden;/);
  assert.match(titleRule, /text-overflow:\s*ellipsis;/);
  assert.match(titleRule, /white-space:\s*nowrap;/);
});

test('narrow reader reserves the Open action before hover to prevent first-click layout shifts', () => {
  // Hosted QA at 320 CSS px / 200% zoom found that a hover-capable browser
  // revealed Open during pointer entry, moving the action away from the click.
  // Width, not the device's hover capability, must make it visible up front.
  const mobileBlock = stylesheet.match(/@media\s*\(max-width:\s*600px\)\s*\{([\s\S]*?)\n\}/)?.[1];
  assert.ok(mobileBlock, 'keep a narrow-screen layout block');
  const mobileRules = [...mobileBlock.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const actionRule = mobileRules.find(([, selector]) => selector.trim() === '.reader-surface .dataviews-view-list div:is([role=row], [role=article]) .dataviews-view-list__item-actions > :not(:last-child)');
  assert.ok(actionRule, 'the narrow primary action rule must not require hover, focus, or selection');
  assert.match(actionRule[2], /flex-basis:\s*max-content;/);
  assert.match(actionRule[2], /width:\s*auto;/);
  assert.match(actionRule[2], /overflow:\s*(?:visible|unset);/);
  assert.doesNotMatch(mobileBlock, /@media\s*\(hover:/, 'narrow action visibility must also apply to a hover-capable desktop browser');
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
