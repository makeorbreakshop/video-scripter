// The versioned cache read against production: md5(bytea) in Postgres equals blobVersion() in
// Node, an unchanged blob comes back null, and a changed or unknown one comes back in full.
// Read-only; three cache rows (~5 KB).
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { makeTimedPool } from '../admin/db';
import { OBS_CACHE_READ_SQL, OBS_CACHE_READ_VERSIONED_SQL } from './obs-cache';
import { blobVersion, MemoryObsBlobStore } from './obs-blob-store';
import { loadCachedRecords } from './prior-load';

const d = process.env.ALLOW_PRODUCTION_INTEGRATION_TESTS === '1' && process.env.DATABASE_URL ? describe : describe.skip;
jest.setTimeout(60_000);

d('OBS_CACHE_READ_VERSIONED_SQL', () => {
  const pool = makeTimedPool({ connectionString: process.env.DATABASE_URL, max: 1, timeoutMs: 20_000 });
  afterAll(() => pool.end());
  const q = async (sql: string, p?: any[]) => (await pool.query(sql, p)).rows;

  it('returns the blob only when its md5 differs from the one the caller holds', async () => {
    const ids: string[] = (await q(`select video_id from video_obs_cache c
       where format = 2 and not exists (select 1 from obs_cache_dirty d where d.video_id = c.video_id)
       limit 3`)).map((r: any) => r.video_id);
    expect(ids).toHaveLength(3);
    const full = await q(OBS_CACHE_READ_SQL, [ids]);
    const byId = new Map(full.map((r: any) => [r.video_id, r.obs as Buffer]));
    const versions = [blobVersion(byId.get(ids[0])!), 'not-the-md5', null];
    const rows = await q(OBS_CACHE_READ_VERSIONED_SQL, [ids, versions]);
    const got = new Map(rows.map((r: any) => [r.video_id, r.obs]));
    expect(got.get(ids[0])).toBeNull();
    expect(Buffer.compare(got.get(ids[1]), byId.get(ids[1])!)).toBe(0);
    expect(Buffer.compare(got.get(ids[2]), byId.get(ids[2])!)).toBe(0);

    // End to end: a warm store yields the same records as a plain read.
    const store = new MemoryObsBlobStore();
    const cold = await loadCachedRecords(q, ids, { requireFormat2: true, blobStore: store });
    const warm = await loadCachedRecords(q, ids, { requireFormat2: true, blobStore: store });
    const plain = await loadCachedRecords(q, ids, { requireFormat2: true });
    expect([...warm.records]).toEqual([...plain.records]);
    expect([...cold.records]).toEqual([...plain.records]);
  });
});
