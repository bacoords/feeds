import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArticleBody } from './ui';

test('article rendering escapes scripts, links, and event-handler HTML', () => {
  const hostileText = '<script>alert(1)</script><img src=x onerror="alert(2)"><a href="javascript:alert(3)">click</a>';
  const html = renderToStaticMarkup(createElement(ArticleBody, { text: hostileText }));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<a '));
});

test('empty feed content gives an explicit fallback, not an empty reader', () => {
  const html = renderToStaticMarkup(createElement(ArticleBody, { text: '' }));
  assert.ok(html.includes('This feed did not include article text.'));
});
