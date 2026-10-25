import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { analyzeZeroSource, compileZeroCapsule, type CompileZeroCapsuleResult } from '@spacefast/zero-compile';

// Execute the real compiler-generated adapter as well as the application code.
// Node's isolated VM is NOT the hosted QuickJS engine, DB, or real auth service.
let compiled: CompileZeroCapsuleResult;
before(async () => {
  const config = JSON.parse(await readFile('sf.jsonc', 'utf8'));
  const root = process.cwd();
  const analysis = await analyzeZeroSource(root, config.runtime);
  compiled = await compileZeroCapsule({ root, analysis, appName: 'Feeds', previousSchema: null, migrationMode: 'safe', shellTitle: 'Feeds', linkThemeStylesheet: false, inspectPolicy: 'private', runnerSha256: null, centralRealtimeUrl: null });
});

async function execute(source: string, globals: Record<string, unknown> = {}) {
  const context = createContext({
    __statticZeroRequest: { bodyBase64: Buffer.from(JSON.stringify({ args: [{}] })).toString('base64') },
    ...globals,
  });
  await runInContext(`(async () => { ${source}\n })()`, context, { timeout: 2000 });
  return JSON.parse(context.__statticZeroResult as string) as { status: number; body: string };
}

test('compiled health endpoint works without a visitor session', async () => {
  const endpoint = compiled.finalizePayload.endpointSources.find(endpoint => endpoint.path === '/api/health')!;
  const result = await execute(endpoint.source);
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), { app: 'Feeds', version: '0.1.0' });
});

test('compiled worker endpoints fail closed without requiring a reader session', async () => {
  for (const endpoint of compiled.finalizePayload.endpointSources.filter(endpoint => endpoint.path !== '/api/health')) {
    const result = await execute(endpoint.source);
    assert.equal(result.status, 503, endpoint.path);
    assert.match(JSON.parse(result.body).error, /disabled|not configured/i);
  }
});

test('compiled worker routes reject missing credentials even when the worker is configured', async () => {
  for (const endpoint of compiled.finalizePayload.endpointSources.filter(endpoint => endpoint.path !== '/api/health' && endpoint.path !== '/api/cron/ingest')) {
    const result = await execute(endpoint.source, {
      __statticEnv: { FEEDS_WORKER_ENABLED: 'true', FEEDS_WORKER_SECRET: 'test-only-not-a-live-secret-0000000000' },
    });
    assert.equal(result.status, 401, endpoint.path);
  }
});

test('compiled native scheduler rejects forged markers and never fetches before authorization', async () => {
  for (const endpoint of compiled.finalizePayload.endpointSources.filter(endpoint => endpoint.path === '/api/cron/ingest')) {
    const result = await execute(endpoint.source, {
      __statticEnv: { CRON_SECRET: 'test-only-not-a-live-secret-0000000000' },
      __statticZeroRequest: { headers: { 'x-spacefast-cron': '1' } },
      fetch: () => { throw new Error('Must not fetch'); },
    });
    assert.equal(result.status, 401);
  }
});

test('compiled native trigger validates bearer then reports disabled without reading or fetching', async () => {
  const endpoint = compiled.finalizePayload.endpointSources.find(endpoint => endpoint.path === '/api/cron/ingest' && endpoint.method === 'GET')!;
  const secret = 'test-only-not-a-live-secret-0000000000';
  const result = await execute(endpoint.source, {
    __statticEnv: { CRON_SECRET: secret },
    __statticZeroRequest: { headers: { authorization: `Bearer ${secret}` } },
    __statticCrypto: (operation: string, payload: { a: string; b: string }) => {
      assert.equal(operation, 'timing_safe_equal'); return payload.a === payload.b;
    },
    fetch: () => { throw new Error('Must not fetch'); },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), { authenticated: true, enabled: false, outcome: 'disabled' });
});

test('compiled reader handlers reject signed-out and guest users before touching data', async () => {
  assert.ok(compiled.finalizePayload.runSources.some(run => run.runId === 'mutation_importOpml'), 'OPML import must be included in compiled authentication coverage');
  for (const identity of [null, { userId: 'guest:test', isAuthenticated: false, isGuest: true }]) {
    for (const run of compiled.finalizePayload.runSources) {
      await assert.rejects(execute(run.source, { __statticAuth: { current: () => identity } }),
        { message: 'Sign in to use Feeds.', status: 401 }, run.runId);
    }
  }
});
