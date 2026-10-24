import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const stylesheet = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

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
