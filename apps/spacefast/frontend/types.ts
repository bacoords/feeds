import type { Article } from '../shared/contracts';
export type { Source, Article, Dashboard } from '../shared/contracts';
export type ArticleState = Partial<Pick<Article, 'read' | 'starred'>>;
export type ReaderScope = 'all' | 'unread' | 'starred' | `source:${string}`;
