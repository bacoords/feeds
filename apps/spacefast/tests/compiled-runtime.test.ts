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
    assert.match(JSON.parse(result.body).error, /disabled/i);
  }
});

test('compiled worker routes reject missing credentials even when the worker is configured', async () => {
  for (const endpoint of compiled.finalizePayload.endpointSources.filter(endpoint => endpoint.path !== '/api/health')) {
    const result = await execute(endpoint.source, {
      __statticEnv: { FEEDS_WORKER_ENABLED: 'true', FEEDS_WORKER_SECRET: 'test-only-not-a-live-secret-0000000000' },
    });
    assert.equal(result.status, 401, endpoint.path);
  }
});

test('compiled reader handlers reject signed-out and guest users before touching data', async () => {
  for (const identity of [null, { userId: 'guest:test', isAuthenticated: false, isGuest: true }]) {
    for (const run of compiled.finalizePayload.runSources) {
      await assert.rejects(execute(run.source, { __statticAuth: { current: () => identity } }),
        { message: 'Sign in to use Feeds.', status: 401 }, run.runId);
    }
  }
});
