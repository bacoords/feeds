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
  // Legacy tables above stay in place until every account has been reconciled.
  feedPools: table({
    url: string(), ownerId: string(), visibility: string(), status: string(),
    nextRunAt: number(), leaseUntil: number(), leaseToken: string(), leaseVersion: number(),
    attempts: number(), completedToken: string(), lastAttemptAt: number(), lastSuccessAt: number(),
    error: string(), etag: string(), lastModified: string(),
  }).index('by_url', ['url']).index('by_url_visibility', ['url', 'visibility']).index('by_url_owner', ['url', 'ownerId']).index('by_due', ['nextRunAt']),
  feedItems: table({
    feedId: string(), key: string(), title: string(), url: string(), bodyText: string(),
    author: string(), publishedAt: string(),
  }).index('by_feed', ['feedId']).index('by_feed_key', ['feedId', 'key']),
  subscriptions: table({
    ownerId: string(), sourceId: string(), feedId: string(),
  }).index('by_owner', ['ownerId']).index('by_source', ['sourceId']).index('by_feed', ['feedId']).index('by_owner_feed', ['ownerId', 'feedId']),
  itemStates: table({
    ownerId: string(), itemId: string(), sourceId: string(), sourceTitle: string(), read: boolean(), starred: boolean(),
  }).index('by_owner', ['ownerId']).index('by_item', ['itemId']).index('by_owner_item', ['ownerId', 'itemId']),
  legacyItemMaps: table({
    ownerId: string(), legacyId: string(), itemId: string(),
  }).index('by_legacy', ['legacyId']).index('by_owner', ['ownerId']),
};
