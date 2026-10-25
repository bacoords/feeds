import assert from 'node:assert/strict';
import test from 'node:test';
import { applyArticleState, articlesInScope, dateLabel, safeExternalUrl, sourceStatus } from './state';
import type { Article } from './types';

const article: Article = { id: 'a', sourceId: 'source:a', sourceTitle: 'Demo', title: 'Example', url: 'https://example.com/article', bodyText: '<script>not executed</script>', author: '', publishedAt: '', read: false, starred: true };

test('marking read preserves a star and marking unread never removes it', () => {
  const read = applyArticleState(article, { read: true });
  assert.equal(read.starred, true);
  assert.equal(read.read, true);
  assert.equal(applyArticleState(read, { read: false }).starred, true);
  assert.equal(article.read, false, 'does not mutate the original record');
});

test('starring does not mark an unread article read', () => {
  const starred = applyArticleState({ ...article, starred: false }, { starred: true });
  assert.equal(starred.starred, true);
  assert.equal(starred.read, false);
});

test('unstarring preserves read state', () => {
  const unstarred = applyArticleState({ ...article, read: true }, { starred: false });
  assert.equal(unstarred.read, true);
  assert.equal(unstarred.starred, false);
});

test('unread and starred filters overlap independently', () => {
  const articles = [article, { ...article, id: 'b', read: true }, { ...article, id: 'c', starred: false, sourceId: 'other' }];
  assert.deepEqual(articlesInScope(articles, 'unread').map(({ id }) => id), ['a', 'c']);
  assert.deepEqual(articlesInScope(articles, 'starred').map(({ id }) => id), ['a', 'b']);
  assert.deepEqual(articlesInScope(articles, 'source:source:a').map(({ id }) => id), ['a', 'b']);
});

test('feed links allow only http(s), reject executable schemes and credentials', () => {
  assert.equal(safeExternalUrl('https://example.com/article'), 'https://example.com/article');
  for (const invalid of ['javascript:alert(1)', 'data:text/html,test', 'file:///etc/passwd', '//example.com', 'https://user:pass@example.com', '/relative', 'not a URL']) assert.equal(safeExternalUrl(invalid), undefined);
});

test('worker absence never displays a feed as active or fetching', () => {
  assert.equal(sourceStatus({ enabled: true, error: null, jobStatus: 'running' }, false), 'Fetching not enabled');
  assert.equal(sourceStatus({ enabled: false, error: null, jobStatus: null }, true), 'Paused');
  assert.equal(sourceStatus({ enabled: true, error: 'Could not parse', jobStatus: 'error' }, true), 'Needs attention');
});


test('sample source is labeled as demo even with no live worker', () => {
  assert.equal(sourceStatus({ enabled: false, error: null, jobStatus: 'demo' }, false), 'Demo source');
});

test('unscheduled zero timestamps do not display an epoch date', () => {
  assert.equal(dateLabel(0), 'Not yet');
  assert.equal(dateLabel(''), 'Not yet');
  assert.equal(dateLabel('invalid'), 'Unknown date');
});
