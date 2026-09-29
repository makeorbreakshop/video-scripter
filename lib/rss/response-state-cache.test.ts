// saveRssObservations read every polled channel's rss_response_state (~2.2 KB of jsonb each) on
// every tick: 32,832 bytes for 15 channels measured 2026-09-29, ~5.7 MB for a 2,600-channel tick.
// With a state cache it sends the md5 of the state it holds and gets the jsonb back only when
// the server's differs; the update returns the new md5 so the cache follows its own writes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveRssObservations, RESPONSE_STATE_READ_VERSIONED_SQL, RESPONSE_STATE_UPDATE_SQL } from './response-store';
import { DiskStateCache, MemoryStateCache } from './response-state-cache';
import type { FeedResponse } from './response-freshness';

const resp = (channelId: string, minute: number): FeedResponse => ({
  channelId, fetchedAt: `2026-09-29T11:${minute}:59Z`, date: `2026-09-29T11:${minute}:00Z`,
  age: '10', cacheControl: 'public, max-age=900', views: { [`${channelId}-v`]: 100 + minute },
});

let versionSeq = 0;
beforeEach(() => { versionSeq = 0; });

/** A fake pool whose rss_response_state lives in `server` (channel -> {md5, state}). */
function fakePool(server: Map<string, { version: string; state: any }>) {
  const sent: { sql: string; values?: any[] }[] = [];
  const client = {
    async query(sql: string, values?: any[]) {
      sent.push({ sql, values });
      if (sql === RESPONSE_STATE_READ_VERSIONED_SQL) {
        const [ids, versions] = values as [string[], (string | null)[]];
        return { rows: ids.map((id, i) => {
          const s = server.get(id);
          if (!s) return { channel_id: id, version: null, state: null };
          return { channel_id: id, version: s.version, state: s.version === versions[i] ? null : s.state };
        }) };
      }
      if (sql === RESPONSE_STATE_UPDATE_SQL) {
        const updates = JSON.parse(values![0]);
        return { rows: updates.map((u: any) => {
          const version = `v${++versionSeq}`;
          server.set(u.channel_id, { version, state: JSON.parse(JSON.stringify(u.state)) });
          return { channel_id: u.channel_id, version };
        }) };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  return { sent, pool: { connect: async () => client, query: client.query } as any };
}

test('a warm cache reads no state bytes, and the cache follows its own committed writes', async () => {
  const server = new Map<string, { version: string; state: any }>();
  const cache = new MemoryStateCache();
  const a = fakePool(server);
  await saveRssObservations(a.pool, [], [resp('UCa', 10)], cache);   // cold: no row yet
  expect(cache.get('UCa')?.version).toBe(server.get('UCa')!.version);

  const b = fakePool(server);
  await saveRssObservations(b.pool, [], [resp('UCa', 20)], cache);
  const read = b.sent.find((s) => s.sql === RESPONSE_STATE_READ_VERSIONED_SQL)!;
  expect(read.values).toEqual([['UCa'], ['v1']]);
  // The second tick advanced from the cached state: two responses counted.
  expect(server.get('UCa')!.state.counters.responses).toBe(2);
  expect(cache.get('UCa')!.value.counters.responses).toBe(2);
});

test('a state changed elsewhere comes back in full and replaces the cached copy', async () => {
  const server = new Map<string, { version: string; state: any }>();
  const cache = new MemoryStateCache();
  await saveRssObservations(fakePool(server).pool, [], [resp('UCa', 10)], cache);
  // Another writer (a replay on another checkout) moved the row on.
  const other = new MemoryStateCache();
  await saveRssObservations(fakePool(server).pool, [], [resp('UCa', 30)], other);
  await saveRssObservations(fakePool(server).pool, [], [resp('UCa', 40)], cache);
  expect(server.get('UCa')!.state.counters.responses).toBe(3);
});

test('nothing is cached from a transaction that rolled back', async () => {
  const server = new Map<string, { version: string; state: any }>();
  const cache = new MemoryStateCache();
  const { pool } = fakePool(server);
  const client = await pool.connect();
  const q = client.query;
  client.query = async (sql: string, values?: any[]) => {
    if (/insert into rss_samples/i.test(sql)) throw new Error('boom');
    return q(sql, values);
  };
  await expect(saveRssObservations(pool, [{ video_id: 'UCa-v', at: '2026-09-29T11:10:59Z', views: 1, likes: 0 }],
                                   [resp('UCa', 10)], cache)).rejects.toThrow('boom');
  expect(cache.get('UCa')).toBeNull();
});

test('the disk cache round-trips and rejects unsafe ids', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rss-state-'));
  new DiskStateCache(dir).put('UCabc_-1', 'md5x', { a: 1 });
  expect(new DiskStateCache(dir).get('UCabc_-1')).toEqual({ version: 'md5x', value: { a: 1 } });
  expect(new DiskStateCache(dir).get('../etc')).toBeNull();
  fs.writeFileSync(path.join(dir, 'UCbad.json'), '{"torn');
  expect(new DiskStateCache(dir).get('UCbad')).toBeNull();
});

test('the versioned read keeps the row lock and compares md5 of the jsonb text', () => {
  expect(RESPONSE_STATE_READ_VERSIONED_SQL).toMatch(/for update of s/i);
  expect(RESPONSE_STATE_READ_VERSIONED_SQL).toMatch(/md5\(s\.state::text\)/);
  expect(RESPONSE_STATE_UPDATE_SQL).toMatch(/returning s\.channel_id, md5\(s\.state::text\) as version/);
});
