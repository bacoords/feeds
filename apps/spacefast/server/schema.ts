import { boolean, number, string, table } from '@spacefast/zero/server';
export const schema = {
  sources: table({
    ownerId: string(), title: string(), url: string(), folder: string(), enabled: boolean(),
    nextPollAt: number(), lastAttemptAt: number(), lastSuccessAt: number(), error: string(),
    etag: string(), lastModified: string(), demo: boolean(),
  }).index('by_owner', ['ownerId']).index('by_owner_url', ['ownerId', 'url']),
  articles: table({
    ownerId: string(), sourceId: string(), key: string(), title: string(), url: string(),
    bodyText: string(), author: string(), publishedAt: string(), read: boolean(), starred: boolean(),
  }).index('by_owner', ['ownerId']).index('by_source', ['sourceId']).index('by_source_key', ['sourceId', 'key']),
  jobs: table({
    ownerId: string(), sourceId: string(), status: string(), nextRunAt: number(),
    leaseUntil: number(), leaseToken: string(), leaseVersion: number(), attempts: number(), completedToken: string(),
  }).index('by_source', ['sourceId']).index('by_due', ['nextRunAt']).index('by_owner', ['ownerId']),
};
