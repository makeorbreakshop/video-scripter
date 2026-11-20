// Against the real local pipeline DB only:
//   RUN_LOCAL_PG_TESTS=1 npx jest --testPathIgnorePatterns=/orchestrator/ --runTestsByPath lib/nightly/api-readings-shadow.db.test.ts
import pg from 'pg';
import { pipelineDatabaseUrl } from '../db/pipeline';
import { shadowSampleBatch, shadowDueSnapshots } from './api-readings-shadow';

const url = pipelineDatabaseUrl();
const suite = process.env.RUN_LOCAL_PG_TESTS === '1' && ['localhost', '127.0.0.1'].includes(new URL(url).hostname) ? describe : describe.skip;

suite('API readings shadow into the local pipeline DB', () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const V = '__api_shadow_test_v';
  const cleanup = async () => {
    for (const t of ['view_samples', 'view_snapshots', 'obs_cache_dirty', 'score_dirty', 'series_dirty', 'observation_change_log']) {
      await pool.query(`delete from ${t} where video_id = $1`, [V]);
    }
    await pool.query(`delete from videos where id = $1`, [V]);
  };
  beforeAll(async () => {
    await cleanup();
    await pool.query(`insert into videos (id, channel_id, title, published_at, import_date, duration, is_short, privacy_status, view_count)
                      values ($1, 'c', 't', now() - interval '3 days', now(), 'PT10M', false, 'public', 0)`, [V]);
  });
  afterAll(async () => { await cleanup(); await pool.end(); });
  const write = (views: number, at = '2026-11-20T20:00:00Z') => ({ videoId: V, sampledAt: new Date(at), views, likes: 2, comments: 3,
    daysSincePublished: 3, phase: 'launch', nextCheck: new Date(), priorNextCheck: '', priorUpdatedAt: '' });
  const snap = async () => (await pool.query(`select view_count from view_snapshots where video_id = $1 and snapshot_date = '2026-11-20'`, [V])).rows;

  it('writes the sample and the day snapshot, and the local triggers fan them out', async () => {
    expect(await shadowSampleBatch(pool, [write(100)])).toEqual({ ok: true, rows: 1 });
    expect((await pool.query(`select view_count from view_samples where video_id = $1`, [V])).rows).toEqual([{ view_count: 100 }]);
    expect(await snap()).toEqual([{ view_count: 100 }]);
    expect((await pool.query(`select count(*)::int n from observation_change_log where video_id = $1`, [V])).rows[0].n).toBeGreaterThan(0);
  });
  it('is idempotent for a retried batch, and a later API reading updates the day snapshot', async () => {
    await shadowSampleBatch(pool, [write(100)]);
    expect((await pool.query(`select count(*)::int n from view_samples where video_id = $1`, [V])).rows[0].n).toBe(1);
    await shadowSampleBatch(pool, [write(150, '2026-11-20T21:00:00Z')]);
    expect(await snap()).toEqual([{ view_count: 150 }]);
  });
  it('track-due: an API pass overwrites the day, an RSS pass never does', async () => {
    const row = (n: number) => ({ video_id: V, snapshot_date: '2026-11-20', view_count: n, like_count: 0, comment_count: 0, days_since_published: 3, daily_views_rate: null });
    await shadowDueSnapshots(pool, [row(90)], false);
    expect(await snap()).toEqual([{ view_count: 150 }]);
    await shadowDueSnapshots(pool, [row(200)], true);
    expect(await snap()).toEqual([{ view_count: 200 }]);
  });
});
