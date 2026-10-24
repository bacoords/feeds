import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harness } from './harness.js';
import * as d from '../server/domain.js';
import type { NormalizedItem } from '../shared/contracts.js';
const item: NormalizedItem = { key: 'guid-1', title: 'One', url: 'https://example.com/article', bodyText: 'Hello', author: 'A', publishedAt: '2026-01-01T00:00:00.000Z' };
const feed = { title: 'Example', url: 'https://example.com/feed.xml' };
const now = 1_000_000;

test('guest IDs are rejected, including a truthy guest identity', async () => {
  const h = harness();
  await assert.rejects(d.dashboard(h.context('guest:123')), /Sign in/);
  await assert.rejects(d.addSource(h.context('guest:123'), feed), /Sign in/); h.close();
});
test('tenants cannot read, modify, refresh, delete or star another user’s data', async () => {
  const h = harness(), alice=h.context(), bob=h.context('bob');
  await d.seedDemo(alice, {}); const a=await d.dashboard(alice); assert.equal(a.articles.length,3);
  assert.equal((await d.dashboard(bob)).sources.length,0);
  for (const run of [() => d.deleteSource(bob,{id:a.sources[0].id}), () => d.updateSource(bob,{id:a.sources[0].id,enabled:false}), () => d.refreshSource(bob,{id:a.sources[0].id}), () => d.setArticleState(bob,{id:a.articles[0].id,starred:true})]) await assert.rejects(run,/not found/);
  h.close();
});
test('independent read/star state survives content upserts and source-scoped GUIDs', async () => {
  const h=harness(), c=h.context(); const s=await d.addSource(c,feed,now); const first=await d.claim(c,now); assert.ok(first);
  await d.finish(c,{...first,status:'success',items:[item]},now+1);
  let article=(await d.dashboard(c)).articles[0];
  await d.setArticleState(c,{id:article.id,read:true,starred:true});
  await d.refreshSource(c,{id:s.id},now+2); const second=await d.claim(c,now+2); assert.ok(second);
  await d.finish(c,{...second,status:'success',items:[{...item,title:'Updated'}]},now+3);
  article=(await d.dashboard(c)).articles[0]; assert.equal(article.title,'Updated'); assert.equal(article.read,true);assert.equal(article.starred,true);
  await d.setArticleState(c,{id:article.id,read:false}); assert.equal((await d.dashboard(c)).articles[0].starred,true);
  await d.addSource(c,{...feed,url:'https://another.example.com/feed'},now+4); const third=await d.claim(c,now+4); assert.ok(third);
  await d.finish(c,{...third,status:'success',items:[item]},now+5); assert.equal((await d.dashboard(c)).articles.length,2); h.close();
});
test('repeated add/refresh/result is idempotent and a live lease cannot be claimed twice', async () => {
  const h=harness(),c=h.context(); const a=await d.addSource(c,feed,now), b=await d.addSource(c,feed,now);assert.equal(a.id,b.id);
  const one=await d.refreshSource(c,{id:a.id},now),two=await d.refreshSource(c,{id:a.id},now); assert.equal(one.jobId,two.jobId);
  const claim=await d.claim(c,now); assert.ok(claim); assert.equal(await d.claim(c,now+1),null);
  const result={...claim,status:'success' as const,items:[item]}; await d.finish(c,result,now+2);assert.equal((await d.finish(c,result,now+3)).duplicate,true);assert.equal((await d.dashboard(c)).articles.length,1);h.close();
});
test('missed cron catches up on claim; transient failures retry without disabling a source', async () => {
  const h=harness(),c=h.context(); await d.addSource(c,feed,now);const job=await d.claim(c,now+100_000);assert.ok(job);
  await d.finish(c,{...job,status:'failure',error:'must not persist user secrets'},now+100_001);
  const s=(await d.dashboard(c)).sources[0];assert.equal(s.enabled,true);assert.equal(s.jobStatus,'retry');assert.ok(!s.error.includes('secrets'));
  assert.equal(await d.claim(c,s.nextPollAt-1),null);assert.ok(await d.claim(c,s.nextPollAt));h.close();
});
test('expired lease is fenced and recovered with backoff after a restart', async () => {
  const dir=mkdtempSync(join(tmpdir(),'feeds-'));const path=join(dir,'db.sqlite');
  let h=harness(path),c=h.context();await d.addSource(c,feed,now);const old=await d.claim(c,now);assert.ok(old);h.close();
  h=harness(path);c=h.context();assert.equal(await d.claim(c,now+60_001),null);
  await assert.rejects(d.finish(c,{...old,status:'success',items:[item]},now+60_002),/stale/);
  const s=(await d.dashboard(c)).sources[0]; const current=await d.claim(c,s.nextPollAt);assert.ok(current);assert.notEqual(current.leaseToken,old.leaseToken);
  await d.finish(c,{...current,status:'success',items:[item]},s.nextPollAt+1);assert.equal((await d.dashboard(c)).articles.length,1);h.close();rmSync(dir,{recursive:true});
});
test('worker authentication requires explicit enabling plus secret, not an app session', async () => {
  const h=harness(),c=h.context();await assert.rejects(d.authenticateWorker(c,null),/Unauthorized/);await assert.rejects(d.authenticateWorker(c,'Bearer invalid'),/Unauthorized/);
  await assert.rejects(d.authenticateWorker(h.context('alice',false),'Bearer invalid'),/disabled/);await d.authenticateWorker(c,`Bearer ${c.env.FEEDS_WORKER_SECRET}`);h.close();
});
test('unconfigured source remains paused; enabling/refresh rejected but demo remains usable', async () => {
  const h=harness(),c=h.context('alice',false);const s=await d.addSource(c,feed,now);assert.equal(s.enabled,false);assert.equal((await d.dashboard(c)).workerConfigured,false);
  await assert.rejects(d.updateSource(c,{id:s.id,enabled:true}),/not configured/);await assert.rejects(d.refreshSource(c,{id:s.id}),/configuring/);await d.seedDemo(c,{});assert.equal((await d.dashboard(c)).articles.length,3);h.close();
});
test('pause and delete fence outstanding work and clean only owned records', async () => {
  const h=harness(),c=h.context();const s=await d.addSource(c,feed,now);const job=await d.claim(c,now);assert.ok(job);await d.updateSource(c,{id:s.id,enabled:false},now+1);
  await assert.rejects(d.finish(c,{...job,status:'success',items:[item]},now+2),/stale/);await d.seedDemo(h.context('bob'),{});await d.deleteSource(c,{id:s.id});assert.equal((await d.dashboard(c)).sources.length,0);assert.equal((await d.dashboard(h.context('bob'))).articles.length,3);h.close();
});
test('conditional 304 updates freshness without destroying articles or validators', async () => {
  const h=harness(),c=h.context();const s=await d.addSource(c,feed,now);const first=await d.claim(c,now);assert.ok(first);await d.finish(c,{...first,status:'success',items:[item],etag:'"v1"'},now+1);
  await d.refreshSource(c,{id:s.id},now+2);const next=await d.claim(c,now+2);assert.ok(next);assert.equal(next.etag,'"v1"');await d.finish(c,{...next,status:'not_modified'},now+3);assert.equal((await d.dashboard(c)).articles.length,1);assert.equal((await d.dashboard(c)).sources[0].lastSuccessAt,now+3);h.close();
});
test('invalid result rolls back all writes in a transaction harness', async () => {
  const h=harness(),c=h.context();await d.addSource(c,feed,now);const job=await d.claim(c,now);assert.ok(job);
  await assert.rejects(h.transaction(()=>d.finish(c,{...job,status:'success',items:[item],etag:'x'.repeat(1025)},now+1)),/ETag/);
  assert.equal((await d.dashboard(c)).articles.length,0);assert.equal((await d.dashboard(c)).sources[0].jobStatus,'running');h.close();
});
test('server validates feed URLs, arbitrary values, batch bounds and unsafe article links',async()=>{
  for(const url of ['http://example.com','https://127.0.0.1/','https://[::1]/','https://0x7f000001/','https://localhost/','https://u:p@example.com/','https://example.com:444/','javascript:alert(1)']) assert.throws(()=>d.safeUrl(url));
  assert.equal(d.safeUrl('https://example.com/feed#hash'),'https://example.com/feed');
  const h=harness(),c=h.context();await d.addSource(c,feed,now);const job=await d.claim(c,now);assert.ok(job);
  await assert.rejects(d.finish(c,{...job,status:'success',items:Array(51).fill(item)},now+1),/batch/);
  await assert.rejects(d.finish(c,{...job,status:'success',items:[item,item]},now+1),/Duplicate/);
  await d.finish(c,{...job,status:'success',items:[{...item,url:'javascript:alert(1)',bodyText:'<script>alert(1)</script>'}]},now+2);assert.equal((await d.dashboard(c)).articles[0].url,'');h.close();
});
test('dashboard is bounded while full article detail remains authenticated and available',async()=>{
  const h=harness(),c=h.context();await d.addSource(c,feed,now);const job=await d.claim(c,now);assert.ok(job);
  await d.finish(c,{...job,status:'success',items:[{...item,bodyText:'x'.repeat(50_000)}]},now+1);
  const summary=(await d.dashboard(c)).articles[0];assert.equal(summary.bodyText.length,2000);
  assert.equal((await d.article(c,{id:summary.id})).bodyText.length,50_000);
  await assert.rejects(d.article(h.context('bob'),{id:summary.id}),/not found/);h.close();
});
test('full feeds pause explicitly without deleting history or silently dropping a batch',async()=>{
  const h=harness(),c=h.context();const source=await d.addSource(c,feed,now);
  for(let n=0;n<200;n++) await h.db.articles.insert({...item,key:`old-${n}`,ownerId:'alice',sourceId:source.id,read:true,starred:true});
  const job=await d.claim(c,now);assert.ok(job);const result=await d.finish(c,{...job,status:'success',items:[item]},now+1);
  assert.equal(result.capacityReached,true);const data=await d.dashboard(c);assert.equal(data.articles.length,200);assert.equal(data.sources[0].enabled,false);assert.equal(data.sources[0].jobStatus,'capacity');assert.match(data.sources[0].error,/200-article/);h.close();
});
