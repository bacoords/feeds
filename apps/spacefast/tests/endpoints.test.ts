import test from 'node:test';
import assert from 'node:assert/strict';
import type { EndpointRequest, ServerContext } from '@spacefast/zero/server';
import app from '../server/index.js';
import { harness } from './harness.js';
function request(headers: Record<string, string> = {}, body = '{}') {
  return { headers: new Headers(headers), text: async () => body } as unknown as EndpointRequest;
}
test('all worker endpoints fail closed when unconfigured, even with forged cron marker', async () => {
  const h = harness(), ctx = h.context('guest:caller', false) as unknown as ServerContext;
  const req = request({ 'x-spacefast-cron': '1' });
  for (const name of ['claim', 'result', 'dispatch'] as const) {
    const response = await app.endpoints[name].handler(ctx, req);
    assert.equal(response.status, 503);
  }
  assert.equal(await h.db.jobs.withIndex('by_due').count(), 0); h.close();
});
test('authenticated app identity does not authorize worker operations', async () => {
  const h = harness(), ctx = h.context('alice') as unknown as ServerContext;
  for (const name of ['claim', 'result', 'dispatch'] as const) {
    const response = await app.endpoints[name].handler(ctx, request());
    assert.equal(response.status, 401);
  }
  h.close();
});
test('native capsule leaves endpoint auth to handlers and declares concrete reader handlers', () => {
  assert.equal(app.auth.requireSignIn, false);
  assert.deepEqual(Object.keys(app.schema).sort(), ['articles','jobs','sources']);
  assert.deepEqual(Object.keys(app.queries).sort(), ['article','dashboard']);
  assert.equal(typeof app.mutations.addSource, 'function');
  assert.equal(typeof app.mutations.importOpml, 'function');
});
