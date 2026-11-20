// Against the real local pipeline DB only:
//   RUN_LOCAL_PG_TESTS=1 npx jest --testPathIgnorePatterns=/orchestrator/ --runTestsByPath lib/ingest/ingest-shadow.db.test.ts
import pg from 'pg';
import { pipelineDatabaseUrl } from '../db/pipeline';
import { shadowWrites } from './ingest-shadow';
import { ingestWrites } from './first-sample';
import { videoInsertSql, videoInsertParams, SYSTEM_USER } from './video-insert';

const url = pipelineDatabaseUrl();
const suite = process.env.RUN_LOCAL_PG_TESTS === '1' && ['localhost', '127.0.0.1'].includes(new URL(url).hostname) ? describe : describe.skip;

suite('touch-drain import shadow into the local pipeline DB', () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const V = '__ingest_shadow_v';
  const cleanup = async () => {
    for (const t of ['view_samples', 'view_snapshots', 'view_tracking_priority', 'obs_cache_dirty', 'score_dirty', 'series_dirty', 'observation_change_log']) {
      await pool.query(`delete from ${t} where video_id = $1`, [V]);
    }
    await pool.query(`delete from videos where id = $1`, [V]);
  };
  beforeAll(cleanup);
  afterAll(async () => { await cleanup(); await pool.end(); });
  const item = { id: V, snippet: { title: 'Shadow import', description: 'd', channelId: 'UCshadow', channelTitle: 'Shadow',
    publishedAt: new Date(Date.now() - 2 * 3600_000).toISOString() }, statistics: { viewCount: '1234', likeCount: '5', commentCount: '6' },
    contentDetails: { duration: 'PT12M' } };
  const writes = (at: Date) => [
    { sql: videoInsertSql(), params: videoInsertParams(item, { is_short: false, shorts_checked_at: 'now' }, { dataSource: 'competitor', userId: SYSTEM_USER }) },
    ...ingestWrites(item, 1, at),
  ];

  it('a new video lands in the replica with its first sample and snapshot', async () => {
    const at = new Date();
    const r = await shadowWrites(pool, writes(at));
    expect(r.ok).toBe(true);
    const q = async (sql: string) => (await pool.query(sql, [V])).rows;
    expect((await q(`select title, channel_id from videos where id = $1`))).toEqual([{ title: 'Shadow import', channel_id: 'UCshadow' }]);
    expect((await q(`select view_count from view_samples where video_id = $1`))).toEqual([{ view_count: 1234 }]);
    expect((await q(`select view_count from view_snapshots where video_id = $1`))).toEqual([{ view_count: 1234 }]);
  });
  it('a retried import is idempotent', async () => {
    const r = await shadowWrites(pool, writes(new Date()));
    expect(r.ok).toBe(true);
    expect((await pool.query(`select count(*)::int n from videos where id = $1`, [V])).rows[0].n).toBe(1);
    expect((await pool.query(`select count(*)::int n from view_snapshots where video_id = $1`, [V])).rows[0].n).toBe(1);
  });
});
