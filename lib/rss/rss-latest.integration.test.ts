// rss_latest must always equal the newest rss_samples row per video (the old LAST_SAMPLES_SQL
// answer: order by at desc limit 1), through inserts, out-of-order inserts and deletes.
// Also guards the live-stream refresh query in scripts/drain-touch-queue.ts against walking
// 30 days of videos heap (369 MB per call, measured 2026-09-23).
//
// Integration test: needs DATABASE_URL and ALLOW_PRODUCTION_INTEGRATION_TESTS=1; every write is
// inside a transaction that is always rolled back.
import dotenv from 'dotenv';
import path from 'path';
import pg from 'pg';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
const DSN = process.env.DATABASE_URL;
const maybe = process.env.ALLOW_PRODUCTION_INTEGRATION_TESTS === '1' && DSN ? describe : describe.skip;

maybe('rss_latest projection', () => {
  let pool: pg.Pool;
  beforeAll(() => { pool = new pg.Pool({ connectionString: DSN, max: 1 }); });
  afterAll(async () => { await pool?.end(); });

  const A = 'zzRSSLATEST1';
  const B = 'zzRSSLATEST2';
  const latest = async (c: pg.PoolClient) => (await c.query(
    `select video_id, at, views from rss_latest where video_id = any($1) order by video_id`, [[A, B]])).rows
    .map(r => [r.video_id, new Date(r.at).toISOString(), r.views == null ? null : Number(r.views)]);
  const truth = async (c: pg.PoolClient) => (await c.query(
    `select distinct on (video_id) video_id, at, views from rss_samples
      where video_id = any($1) order by video_id, at desc`, [[A, B]])).rows
    .map(r => [r.video_id, new Date(r.at).toISOString(), r.views == null ? null : Number(r.views)]);

  it('tracks the newest reading per video', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query(`set local statement_timeout = '30s'`);
      await c.query(`insert into rss_samples (video_id, at, views) values
        ($1, '2099-01-01T00:00:00Z', 10), ($1, '2099-01-01T01:00:00Z', 20), ($2, '2099-01-01T00:00:00Z', null)`, [A, B]);
      expect(await latest(c)).toEqual([[A, '2099-01-01T01:00:00.000Z', 20], [B, '2099-01-01T00:00:00.000Z', null]]);

      // An older reading arriving later never replaces the newest one.
      await c.query(`insert into rss_samples (video_id, at, views) values ($1, '2099-01-01T00:30:00Z', 15)`, [A]);
      expect(await latest(c)).toEqual(await truth(c));
      expect((await latest(c))[0][2]).toBe(20);

      // Deleting the newest row falls back to the next newest; deleting the last row removes it.
      await c.query(`delete from rss_samples where video_id = $1 and at = '2099-01-01T01:00:00Z'`, [A]);
      await c.query(`delete from rss_samples where video_id = $1`, [B]);
      expect(await latest(c)).toEqual([[A, '2099-01-01T00:30:00.000Z', 15]]);
      expect(await latest(c)).toEqual(await truth(c));
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  }, 60000);

  it('the live-stream refresh query uses the P0D partial index', async () => {
    const plan = (await pool.query(`explain select id from videos where duration = 'P0D'
      and published_at > now() - interval '30 days' limit 500`)).rows.map(r => r['QUERY PLAN']).join('\n');
    expect(plan).toContain('videos_live_p0d_published_idx');
  });
});
