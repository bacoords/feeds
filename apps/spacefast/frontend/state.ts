import type { Article, ArticleState, ReaderScope } from './types';

/** Read and star state are independent; changing one never infers the other. */
export function applyArticleState(article: Article, patch: ArticleState): Article {
  return {
    ...article,
    read: patch.read ?? article.read,
    starred: patch.starred ?? article.starred,
  };
}

export function articlesInScope(articles: Article[], scope: ReaderScope): Article[] {
  if (scope === 'unread') return articles.filter((article) => !article.read);
  if (scope === 'starred') return articles.filter((article) => article.starred);
  if (scope.startsWith('source:')) {
    return articles.filter((article) => article.sourceId === scope.slice(7));
  }
  return articles;
}

/** Feed-provided links must never become executable or privileged URLs. */
export function safeExternalUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export function dateLabel(value: string | number | null, includeTime = false): string {
  if (value === null || value === '' || value === undefined || value === 0) return 'Not yet';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unknown date';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    ...(includeTime ? { hour: 'numeric', minute: '2-digit' } as const : {}),
  }).format(date);
}

export function sourceStatus(source: { enabled: boolean; error: string | null; jobStatus: string | null }, workerConfigured: boolean): string {
  if (source.jobStatus === 'demo') return 'Demo source';
  if (!workerConfigured) return 'Fetching not enabled';
  if (!source.enabled) return 'Paused';
  if (source.error) return 'Needs attention';
  if (source.jobStatus === 'running') return 'Fetching';
  if (source.jobStatus === 'queued' || source.jobStatus === 'pending') return 'Queued';
  return 'Active';
}
