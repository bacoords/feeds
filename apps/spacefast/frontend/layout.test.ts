import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Source-level layout contracts are not browser geometry/touch verification.
const stylesheet = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('./Workspace.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');
const themeTokens = readFileSync(new URL('../node_modules/@wordpress/theme/prebuilt/css/design-tokens.css', import.meta.url), 'utf8');
const rules = [...stylesheet.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, selector, declarations]) => ({ selector: selector.trim(), declarations }));
function declarationsFor(selector: string): string {
  return rules.filter(rule => rule.selector === selector).map(rule => rule.declarations).join('\n');
}

test('body can shrink below 320px without masking horizontal overflow', () => {
  const bodyRules = [...stylesheet.matchAll(/(?:^|\n)body\s*\{([^}]+)\}/g)];
  assert.equal(bodyRules.length, 1);
  assert.match(bodyRules[0][1], /(?:^|;)\s*min-width\s*:\s*0(?:px)?\s*;/);
  assert.doesNotMatch(bodyRules[0][1], /(?:^|;)\s*overflow(?:-x)?\s*:\s*(?:hidden|clip)\b/);
});

test('mobile workspace is full bleed with one compact toolbar and no DataViews wrappers', () => {
  const mobileBase = stylesheet.slice(0, stylesheet.indexOf('@media (min-width: 800px)'));
  assert.match(mobileBase, /\.workspace\s*\{[^}]*padding:\s*0;/);
  assert.match(mobileBase, /\.workspace-header\s*\{[^}]*min-height:\s*64px;/);
  assert.match(declarationsFor('.workspace-header .app-button'), /min-width:\s*44px;/);
  assert.match(declarationsFor('.workspace-header .app-button'), /min-height:\s*44px;/);
  assert.doesNotMatch(declarationsFor('.reader-surface'), /border(?:-radius)?:/);
  assert.doesNotMatch(`${workspace}\n${main}\n${stylesheet}`, /@wordpress\/dataviews|dataviews-|<DataViews/);
  assert.doesNotMatch(workspace, /workspace-kicker|workspace-subtitle|>Library<|title="Library"/);
});

test('article row is a full-width native click target without moving or overlaying title actions', () => {
  const row = declarationsFor('.article-row');
  assert.match(row, /display:\s*block;/);
  assert.match(row, /width:\s*100%;/);
  assert.match(row, /min-width:\s*0;/);
  assert.match(row, /touch-action:\s*pan-y pinch-zoom;/);
  assert.match(row, /border-radius:\s*0;/);
  assert.doesNotMatch(workspace, /onTouchStart|onPointerDown|onMouseDown/,
    'opening belongs to native click, not the beginning of a scroll gesture');
  assert.doesNotMatch(declarationsFor('.article-row:hover'), /padding|margin|width|height/);
  assert.match(declarationsFor('.article-row:focus-visible'), /outline:\s*2px solid/);
});

test('article hierarchy uses readable mobile type and bounded source/excerpt text', () => {
  assert.match(declarationsFor('.article-title'), /font-size:\s*19px;/);
  assert.match(declarationsFor('.article-excerpt'), /font-size:\s*16px;/);
  assert.match(declarationsFor('.article-excerpt'), /-webkit-line-clamp:\s*3;/);
  assert.match(declarationsFor('.article-source'), /min-width:\s*0;/);
  assert.match(declarationsFor('.article-source'), /text-overflow:\s*ellipsis;/);
  assert.match(declarationsFor('.article-meta time'), /flex-shrink:\s*0;/);
});

test('sidebar unread counts stay on one line while long source titles shrink', () => {
  const countRule = declarationsFor('.nav-count');
  assert.match(countRule, /flex:\s*0\s+0\s+auto;/);
  assert.match(countRule, /min-width:\s*calc\(2ch\s*\+\s*8px\);/);
  assert.match(countRule, /white-space:\s*nowrap;/);
  assert.match(countRule, /overflow-wrap:\s*normal;/);
  assert.match(countRule, /font-variant-numeric:\s*tabular-nums;/);
  const titleRule = declarationsFor('.source-nav > span:nth-child(2)');
  assert.match(titleRule, /flex:\s*1\s+1\s+auto;/);
  assert.match(titleRule, /min-width:\s*0;/);
  assert.match(titleRule, /text-overflow:\s*ellipsis;/);
});

test('reader palette follows installed WordPress semantic tokens', () => {
  for (const alias of ['paper', 'canvas', 'ink', 'muted', 'border', 'subtle-border', 'accent', 'accent-soft']) {
    assert.match(stylesheet, new RegExp(`--${alias}:\\s*var\\(--wpds-color-`));
  }
  const usedTokens = new Set([...stylesheet.matchAll(/var\((--wpds-[\w-]+)/g)].map(match => match[1]));
  for (const token of usedTokens) assert.ok(themeTokens.includes(`${token}:`), `${token} exists in installed theme`);
  assert.doesNotMatch(stylesheet, /@media\s*\(prefers-color-scheme:/);
  assert.doesNotMatch(stylesheet, /--(?:wpds|wp-components|wp-admin)-[\w-]+\s*:/);
});

test('dialogs retain scrolling and portal isolation without legacy offsets', () => {
  assert.match(declarationsFor('.article-drawer .app-dialog-content'), /padding:\s*0;/);
  assert.doesNotMatch(stylesheet, /components-modal__|padding-top:\s*84px/);
  assert.match(declarationsFor('.app-dialog'), /min-width:\s*0;/);
  assert.match(declarationsFor('.sidebar.mobile-sidebar'), /display:\s*flex;/);
  assert.match(declarationsFor('#root'), /isolation:\s*isolate;/);
  assert.match(declarationsFor('body'), /position:\s*relative;/);
});


test('read items dim only their copy and restore full visibility for keyboard focus', () => {
  assert.match(declarationsFor('.article-row.is-read .article-row-copy'), /opacity:\s*\.62;/);
  assert.match(declarationsFor('.article-row.is-read:focus-visible .article-row-copy'), /opacity:\s*1;/);
  assert.match(declarationsFor('.article-row.is-read :is(.article-title, .article-meta, .article-excerpt)'), /color:\s*var\(--ink\);/);
  assert.match(stylesheet, /@media \(prefers-contrast: more\) \{ \.article-row\.is-read \.article-row-copy \{ opacity: 1;/);
  assert.doesNotMatch(declarationsFor('.article-row'), /opacity:/);
  assert.doesNotMatch(declarationsFor('.swipe-row'), /opacity:/);
  assert.match(workspace, /className="article-row-copy"/);
});
