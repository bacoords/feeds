import { boolean, capsule, endpoint, json, mutation, number, query, string, table } from '@spacefast/zero/server';
import type { EndpointResponse } from '@spacefast/zero/server';
import * as domain from './domain.js';
import type { WorkerResult } from '../shared/contracts.js';
import { authenticateNativeTrigger, nativeFetchProbe, nativeTick } from './native-ingestion.js';

async function response(run: () => Promise<unknown>, status = 200): Promise<EndpointResponse> {
  try { return json(await run(), { status, headers: { 'cache-control': 'no-store' } }); }
  catch (error) {
    if (error instanceof domain.DomainError) return json({ error: error.message }, { status: error.status, headers: { 'cache-control': 'no-store' } });
    throw error; // Let the transaction roll back. Never turn an unknown write failure into a commit.
  }
}
export default capsule({
  name: 'Feeds',
  // Do not set capsule-wide requireSignIn: Zero applies it before endpoints,
  // which would reject public health and separately authenticated worker calls.
  // Every reader query/mutation authenticates in domain.owner before data access.
  auth: { requireSignIn: false },
  // Keep this literal: Zero analyzes schema declarations without evaluating imports.
  // build-zero verifies parity with the typed schema used by domain services.
  schema: {
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
},
  queries: { dashboard: query(domain.dashboard), article: query(domain.article) },
  mutations: {
    addSource: mutation((ctx: domain.WriteContext, input: Parameters<typeof domain.addSource>[1]) => domain.addSource(ctx, input)), updateSource: mutation((ctx: domain.WriteContext, input: Parameters<typeof domain.updateSource>[1]) => domain.updateSource(ctx, input)),
    deleteSource: mutation((ctx: domain.WriteContext, input: Parameters<typeof domain.deleteSource>[1]) => domain.deleteSource(ctx, input)), refreshSource: mutation((ctx: domain.WriteContext, input: Parameters<typeof domain.refreshSource>[1]) => domain.refreshSource(ctx, input)),
    setArticleState: mutation((ctx: domain.WriteContext, input: Parameters<typeof domain.setArticleState>[1]) => domain.setArticleState(ctx, input)), seedDemo: mutation((ctx: domain.WriteContext, input: Parameters<typeof domain.seedDemo>[1]) => domain.seedDemo(ctx, input)),
  },
  endpoints: {
    health: endpoint({ method: 'GET', path: '/api/health' }, () => json({ app: 'Feeds', version: '0.1.0' })),
    ingest: endpoint({ method: 'GET', path: '/api/cron/ingest', readOnly: false }, async (raw, req) => {
      const ctx = raw as unknown as domain.WriteContext;
      return response(async () => {
        // A marker header is not authentication. Missing secret always fails.
        await authenticateNativeTrigger(ctx, req.headers.get('authorization'));
        const result = await nativeTick(ctx);
        raw.log.info('feeds.native-trigger', { authenticated: true, enabled: result.enabled, outcome: result.outcome });
        return result;
      });
    }),
    ingestionProbe: endpoint({ method: 'POST', path: '/api/cron/ingest', readOnly: false }, async (raw, req) => {
      const ctx = raw as unknown as domain.WriteContext;
      return response(async () => {
        await authenticateNativeTrigger(ctx, req.headers.get('authorization'));
        return nativeFetchProbe(ctx);
      });
    }),
    // Transport authentication does not depend on visitor cookies. The credential is
    // limited to these ingestion operations, never a Spacefast management credential.
    claim: endpoint({ method: 'POST', path: '/api/worker/claim' }, async (raw, req) => {
      const ctx = raw as unknown as domain.WriteContext;
      return response(async () => {
        await domain.authenticateWorker(ctx, req.headers.get('authorization'));
        return domain.claim(ctx);
      });
    }),
    result: endpoint({ method: 'POST', path: '/api/worker/result' }, async (raw, req) => {
      const ctx = raw as unknown as domain.WriteContext;
      // Authentication/shape errors happen before any write. Domain errors during
      // completion must throw so malformed batches cannot partially commit.
      try { await domain.authenticateWorker(ctx, req.headers.get('authorization')); }
      catch (error) {
        if (error instanceof domain.DomainError) return json({ error: error.message }, { status: error.status, headers: { 'cache-control': 'no-store' } });
        throw error;
      }
      const body = await req.text();
      if (body.length > 1_000_000) return json({ error: 'Result is too large.' }, { status: 413 });
      let input: WorkerResult;
      try { input = JSON.parse(body) as WorkerResult; } catch { return json({ error: 'Invalid JSON.' }, { status: 400 }); }
      return json(await domain.finish(ctx, input), { headers: { 'cache-control': 'no-store' } });
    }),
    dispatch: endpoint({ method: 'GET', path: '/api/cron/dispatch', readOnly: false }, async (raw, req) => {
      const ctx = raw as unknown as domain.WriteContext;
      return response(async () => {
        // No trust in x-spacefast-cron: exact authenticity contract is unverified.
        // A configured worker dispatches missed schedules when claiming work.
        await domain.authenticateWorker(ctx, req.headers.get('authorization'));
        return domain.dispatch(ctx);
      });
    }),
  },
});
