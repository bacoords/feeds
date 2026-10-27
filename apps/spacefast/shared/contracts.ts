export type Source = {
  id: string; title: string; url: string; folder: string; enabled: boolean;
  nextPollAt: number; lastAttemptAt: number; lastSuccessAt: number; error: string; jobStatus: string;
};
export type Article = {
  id: string; sourceId: string; sourceTitle: string; title: string; url: string;
  bodyText: string; author: string; publishedAt: string; read: boolean; starred: boolean;
};
export type Dashboard = { sources: Source[]; articles: Article[]; workerConfigured: boolean };
export type NormalizedItem = { key: string; title: string; url: string; bodyText: string; author: string; publishedAt: string };
export type WorkerResult = {
  jobId: string; leaseToken: string; status: 'success' | 'not_modified' | 'failure';
  items?: NormalizedItem[]; etag?: string; lastModified?: string; error?: string;
};
