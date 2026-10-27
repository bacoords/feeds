// A persisted SQLite harness for domain contracts, NOT a Spacefast/MySQL emulator.
// Transactions are serialized here. Hosted isolation/lock behavior remains a release gate.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHmac, createHash, timingSafeEqual } from 'node:crypto';
import type { WriteContext } from '../server/domain.js';
type Row = Record<string, any>;
export function harness(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE IF NOT EXISTS records (table_name TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(table_name,id))');
  const api: Record<string, any> = {};
  for (const name of ['sources', 'articles', 'jobs', 'feedPools', 'feedItems', 'subscriptions', 'itemStates', 'legacyItemMaps']) {
    api[name] = {
      async get(id: string) { const row = db.prepare('SELECT data FROM records WHERE table_name=? AND id=?').get(name, id); return row ? JSON.parse(row.data as string) : null; },
      async insert(value: Row) { const row = { ...value, id: randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; db.prepare('INSERT INTO records VALUES(?,?,?)').run(name, row.id, JSON.stringify(row)); return row; },
      async update(id: string, patch: Row) { const row = await api[name].get(id); if (!row) return null; const updated = { ...row, ...patch }; db.prepare('UPDATE records SET data=? WHERE table_name=? AND id=?').run(JSON.stringify(updated), name, id); return updated; },
      async delete(id: string) { return db.prepare('DELETE FROM records WHERE table_name=? AND id=?').run(name, id).changes > 0; },
      withIndex(_index: string, build?: (range: any) => void) {
        const predicates: ((r: Row) => boolean)[] = [];
        const range = { eq(k: string, v: unknown) { predicates.push(r => r[k] === v); return range; }, lte(k: string, v: number) { predicates.push(r => r[k] <= v); return range; } };
        build?.(range);
        let reverse = false;
        const rows = () => { const result = db.prepare('SELECT data FROM records WHERE table_name=? ORDER BY rowid').all(name).map(r => JSON.parse(r.data as string)).filter(r => predicates.every(p => p(r))); return reverse ? result.reverse() : result; };
        const query = { order(order: string) { reverse = order === 'desc'; return query; }, async collect() { return rows(); }, async take(limit: number) { return rows().slice(0, limit); }, async first() { return rows()[0] ?? null; }, async count() { return rows().length; }, async paginate({ cursor, numItems }: { cursor: string | null; numItems: number }) { const start = Number(cursor ?? 0); const all = rows(); return { page: all.slice(start, start + numItems), continueCursor: start + numItems < all.length ? String(start + numItems) : null, isDone: start + numItems >= all.length }; } };
        return query;
      },
    };
  }
  function context(user = 'alice', enabled = true): WriteContext {
    return {
      db: api,
      auth: { userId: user, isAuthenticated: !user.startsWith('guest:') },
      env: enabled ? { FEEDS_NATIVE_INGESTION_ENABLED: 'false', FEEDS_WORKER_ENABLED: 'true', FEEDS_WORKER_SECRET: 'test-only-not-a-live-secret-0000000000' } : { FEEDS_NATIVE_INGESTION_ENABLED: 'false' },
      crypto: {
        async sha256(data: string) { return createHash('sha256').update(data).digest('hex'); },
        async hmacSha256({key,data}: {key: {value: string};data:string}) { return createHmac('sha256', key.value).update(data).digest('hex'); },
        async timingSafeEqual(a: string,b: string) { return a.length === b.length && timingSafeEqual(Buffer.from(a),Buffer.from(b)); },
      },
      invalidate() {},
    } as unknown as WriteContext;
  }
  async function transaction<T>(run: () => Promise<T>) {
    db.exec('BEGIN IMMEDIATE');
    try { const value = await run(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return { context, transaction, close: () => db.close(), db: api };
}
