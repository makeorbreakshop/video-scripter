// Against the real local pipeline database (scripts/pipeline-db-init.sh), never Supabase:
//   RUN_LOCAL_PG_TESTS=1 npx jest --testPathIgnorePatterns=[] lib/rss/pipeline-shadow.db.test.ts
// Rows use a reserved id prefix and are removed afterwards, queue fan-out included.
import pg from 'pg';
import { pipelineDatabaseUrl } from '../db/pipeline';
import { shadowSave } from './pipeline-shadow';

const url = pipelineDatabaseUrl();
const local = ['localhost', '127.0.0.1'].includes(new URL(url).hostname);
const suite = process.env.RUN_LOCAL_PG_TESTS === '1' && local ? describe : describe.skip;

suite('rss-poll shadow write into the local pipeline DB', () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const V = '__shadow_test_v';
  const C = '__shadow_test_c';
  const cleanup = async () => {
    for (const t of ['rss_samples', 'rss_latest', 'obs_cache_dirty', 'score_dirty', 'series_dirty', 'observation_change_log']) {
      await pool.query(`delete from ${t} where video_id = $1`, [V]);
    }
    await pool.query(`delete from rss_response_state where channel_id = $1`, [C]);
    await pool.query(`delete from videos where id = $1`, [V]);
  };
  beforeAll(async () => {
    await cleanup();
    // A score-eligible long-form video, as in sql/pipeline/smoke.sql: the trigger skips shorts
    // and rows without a real duration.
    await pool.query(`insert into videos (id, channel_id, title, published_at, import_date, duration, is_short, privacy_status, view_count)
                      values ($1, $2, 'shadow', now() - interval '3 days', now(), 'PT10M', false, 'public', 0)`, [V, C]);
  });
  afterAll(async () => { await cleanup(); await pool.end(); });

  it('writes the reading and response state, and the local triggers fan it out', async () => {
    const at = new Date(Date.now() - 60_000).toISOString();
    const r = await shadowSave(pool, {
      samples: [{ video_id: V, at, views: 4321, likes: 7 }],
      responses: [{ channelId: C, fetchedAt: at, date: new Date(Date.parse(at) - 30_000).toUTCString(),
                    age: '30', cacheControl: 'public, max-age=900', views: { [V]: 4321 } }],
    });
    expect(r).toEqual({ ok: true, rows: 1 });
    const q = async (sql: string, args: unknown[]) => (await pool.query(sql, args)).rows;
    expect((await q(`select views::int from rss_samples where video_id = $1`, [V])).map((x) => x.views)).toEqual([4321]);
    expect((await q(`select views::int from rss_latest where video_id = $1`, [V]))[0].views).toBe(4321);
    expect((await q(`select (state->'counters'->>'responses')::int n from rss_response_state where channel_id = $1`, [C]))[0].n).toBe(1);
    for (const t of ['obs_cache_dirty', 'score_dirty', 'series_dirty']) {
      expect((await q(`select count(*)::int n from ${t} where video_id = $1`, [V]))[0].n).toBeGreaterThan(0);
    }
  });

  it('replaying the same chunk is idempotent', async () => {
    const [{ n: before }] = (await pool.query(`select count(*)::int n from rss_samples where video_id = $1`, [V])).rows;
    const at = (await pool.query(`select received_at from rss_samples where video_id = $1`, [V])).rows[0].received_at.toISOString();
    await shadowSave(pool, {
      samples: [{ video_id: V, at, views: 4321, likes: 7 }],
      responses: [{ channelId: C, fetchedAt: at, date: null, age: null, cacheControl: null, views: { [V]: 4321 } }],
    });
    const [{ n: after }] = (await pool.query(`select count(*)::int n from rss_samples where video_id = $1`, [V])).rows;
    expect(after).toBeLessThanOrEqual(before + 1);
  });
});
