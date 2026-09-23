// enqueue_observation_changes fans every rss/sample/snapshot write out to observation_change_log,
// obs_cache_dirty, score_dirty and series_dirty. The set-based body
// (supabase/migrations/20260923120000_set_based_observation_enqueue.sql) must leave exactly the
// queue state the previous body did, and must read public.videos once per call.
//
// Integration test: needs DATABASE_URL and ALLOW_PRODUCTION_INTEGRATION_TESTS=1. Everything runs
// inside one transaction that is always rolled back; the migration's function is installed only
// inside that transaction.
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import pg from 'pg';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

const DSN = process.env.DATABASE_URL;
const maybe = process.env.ALLOW_PRODUCTION_INTEGRATION_TESTS === '1' && DSN ? describe : describe.skip;
const MIGRATION = path.resolve(
  __dirname, '../../supabase/migrations/20260923120000_set_based_observation_enqueue.sql');

function migrationBody(): string {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  const m = sql.match(/^begin;\n([\s\S]*)\ncommit;\s*$/m);
  if (!m) throw new Error('migration must wrap its body in begin; ... commit;');
  return m[1];
}

// Normalised queue state for the fixture videos, created after the `mark` boundary. Sequence
// values and change ids differ between runs, so compare relationships, not raw numbers.
const STATE_SQL = `
  with mark as (select $1::bigint as mark_id, $2::bigint as mark_gen)
  select json_build_object(
    'log', (select coalesce(json_agg(json_build_array(video_id, source, operation, at, views,
              time_basis, received_at, model_eligible, conflicted) order by change_id), '[]')
              from observation_change_log, mark where observation_change_log.change_id > mark.mark_id),
    'obs', (select coalesce(json_agg(json_build_array(d.video_id, d.requires_bootstrap, d.marked_at,
              d.not_before, d.generation = (select max(l.change_id) from observation_change_log l, mark
                                             where l.video_id = d.video_id and l.change_id > mark.mark_id))
              order by d.video_id), '[]')
              from obs_cache_dirty d where d.video_id = any($3)),
    'score', (select coalesce(json_agg(json_build_array(d.video_id, d.reason, d.marked_at, d.not_before,
              d.generation > (select mark_gen from mark)) order by d.video_id), '[]')
              from score_dirty d where d.video_id = any($3)),
    'series', (select coalesce(json_agg(json_build_array(d.video_id, d.marked_at,
              d.generation > (select mark_gen from mark)) order by d.video_id), '[]')
              from series_dirty d where d.video_id = any($3))) as state`;

maybe('enqueue_observation_changes set-based body', () => {
  let pool: pg.Pool;
  beforeAll(() => { pool = new pg.Pool({ connectionString: DSN, max: 1 }); });
  afterAll(async () => { await pool?.end(); });

  it('matches the previous body on a mixed payload and reads videos once', async () => {
    const c = await pool.connect();
    const mark = async () => (await c.query(
      `select (select coalesce(max(change_id), 0) from observation_change_log) as change_id,
              (select last_value from pipeline_generation_seq) as gen`)).rows[0];
    try {
      await c.query('begin');
      await c.query(`set local statement_timeout = '60s'`);
      // One score-eligible long-form video, one Short (never score-queued), one unknown id.
      const eligible = (await c.query(
        `select id from videos where published_at is not null and is_short = false
            and shorts_checked_at is not null and coalesce(privacy_status,'public') = 'public'
            and duration ~ '^PT' order by published_at desc limit 1`)).rows[0]?.id;
      const short = (await c.query(
        `select id from videos where is_short = true and published_at is not null
          order by published_at desc limit 1`)).rows[0]?.id;
      expect(eligible && short).toBeTruthy();
      const ids = [eligible, short];
      const payload = JSON.stringify([
        { video_id: eligible, source: 'rss', operation: 'upsert', at: '2099-01-01T00:00:00Z', views: 10,
          time_basis: 'published', received_at: '2099-01-01T00:00:01Z', model_eligible: true, conflicted: false },
        { video_id: short, source: 'sample', operation: 'upsert', at: '2099-01-01T00:00:00Z', views: 5 },
        { video_id: 'zzNOTAVIDEO', source: 'rss', operation: 'upsert', at: '2099-01-01T00:00:00Z', views: 1 },
        { video_id: '', source: 'rss', operation: 'upsert', at: '2099-01-01T00:00:00Z' },
        { video_id: eligible, source: 'snapshot', operation: 'delete', at: '2098-12-31T12:00:00Z' },
        { video_id: eligible, source: 'rss', operation: 'upsert', at: '2099-01-01T00:05:00Z', views: 12,
          model_eligible: null, conflicted: true },
      ]);

      await c.query('savepoint previous');
      let m = await mark();
      await c.query('select public.enqueue_observation_changes($1::jsonb)', [payload]);
      const before = (await c.query(STATE_SQL, [m.change_id, m.gen, ids])).rows[0].state;
      await c.query('rollback to savepoint previous');

      await c.query(migrationBody());
      const src = (await c.query(
        `select prosrc from pg_proc where oid = 'public.enqueue_observation_changes(jsonb)'::regprocedure`,
      )).rows[0].prosrc as string;
      expect(src.match(/public\.videos\b/g)?.length).toBe(1);

      m = await mark();
      await c.query('select public.enqueue_observation_changes($1::jsonb)', [payload]);
      const after = (await c.query(STATE_SQL, [m.change_id, m.gen, ids])).rows[0].state;

      expect(after).toEqual(before);
      // Spec, independent of the old body: unknown/empty ids dropped, payload order kept,
      // Shorts never score-queued, every known video series-queued with a fresh generation.
      expect(after.log.map((r: unknown[]) => [r[0], r[2]])).toEqual(
        [[eligible, 'upsert'], [short, 'upsert'], [eligible, 'delete'], [eligible, 'upsert']]);
      expect(after.log[3][7]).toBe(true);      // null model_eligible defaults to true
      expect(after.obs.every((r: unknown[]) => r[4] === true)).toBe(true);
      expect(after.score.find((r: unknown[]) => r[0] === eligible)?.[4]).toBe(true);
      expect(after.score.find((r: unknown[]) => r[0] === short)?.[4] ?? false).toBe(false);
      expect(after.series.every((r: unknown[]) => r[2] === true)).toBe(true);
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  }, 120000);
});
