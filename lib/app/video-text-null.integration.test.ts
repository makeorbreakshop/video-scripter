// The null-out and the ingest side-row writes, against the real schema and its triggers.
//
// Would this have caught 2026-09-14..26? Yes: the scenario below has an unmoved video in the
// same window as a clearable one — the state every real night was in — and asserts that the
// clearable row IS cleared. Under the old design that night was a stand-down and nothing moved.
//
// Integration test: needs DATABASE_URL and ALLOW_PRODUCTION_INTEGRATION_TESTS=1. Everything runs
// in one transaction that is always rolled back; the rows use ids no YouTube video can have.
import dotenv from 'dotenv';
import path from 'path';
import pg from 'pg';
import { moveWindowSql, nullWindowSql, MIRROR_TRIGGER_SQL } from './video-text-move';
import { planNullOut } from './null-out-gate';
import { videoInsertSql, videoInsertParams, SYSTEM_USER } from '../ingest/video-insert';
import { broadcastMetadataWrite } from '../ingest/first-sample';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
const DSN = process.env.DATABASE_URL;
const maybe = process.env.ALLOW_PRODUCTION_INTEGRATION_TESTS === '1' && DSN ? describe : describe.skip;

const P = 'zzzzzzzzDiskGrowth';
const [A, B, C, D, E] = ['A', 'B', 'C', 'D', 'E'].map((x) => `${P}${x}`);

maybe('video_text null-out and ingest, in a rolled-back transaction', () => {
  let pool: pg.Pool;
  let c: pg.PoolClient;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DSN, max: 1 });
    c = await pool.connect();
    await c.query('begin');
    await c.query(`set local statement_timeout = '30s'`);
    const ins = (id: string, summary: string | null, desc = 'd') => c.query(
      `insert into videos (id, channel_id, title, published_at, view_count, user_id, description, llm_summary)
       values ($1, 'UCzzzzDiskGrowth', 't', now() - interval '3 days', 0, $2, $3, $4)`, [id, SYSTEM_USER, desc, summary]);
    await ins(A, 'summary A');                // moved, equal → cleared
    await ins(B, 'summary B');                // NOT moved → untouched, counted as unmoved
    await ins(C, 'summary C');                // moved, side copy differs → untouched, counted
    await ins(D, null);                       // moved, nothing held → not counted at all
    await c.query(`insert into video_text (video_id, description, llm_summary) values
      ($1, 'd', 'summary A'), ($2, 'd', 'a different summary'), ($3, 'd', null)`, [A, C, D]);
  });
  afterAll(async () => {
    await c?.query('rollback').catch(() => {});
    c?.release();
    await pool?.end();
  });

  const windowIds = async () => (await c.query(
    `select id from videos where id > $1 order by id limit 10`, [P])).rows.map((r) => r.id);

  it('the test window holds only our rows (guards every assertion below)', async () => {
    expect(await windowIds()).toEqual([A, B, C, D]);
  });

  it('the plan runs with an unmoved video present — the state all twelve real nights were in', async () => {
    const triggers = (await c.query(MIRROR_TRIGGER_SQL)).rows.map((r) => r.tgname);
    expect(planNullOut({ mirrorTriggers: triggers, columns: ['llm_summary'] })).toEqual(
      { action: 'run', columns: ['llm_summary'] });
  });

  it('clears the proved row, leaves the unmoved and the disagreeing ones, and counts both', async () => {
    const [r] = (await c.query(nullWindowSql(['llm_summary']), [P, 10])).rows;
    expect(r).toMatchObject({ next_cursor: D, scanned: 4, cleared: 1, disagree: 1, unmoved_holding: 1 });
    const now = (await c.query(
      `select v.id, v.llm_summary, vt.llm_summary as side from videos v left join video_text vt on vt.video_id = v.id
        where v.id = any($1) order by v.id`, [[A, B, C, D]])).rows;
    expect(now).toEqual([
      { id: A, llm_summary: null, side: 'summary A' },          // cleared; the side copy survives
      { id: B, llm_summary: 'summary B', side: null },          // unmoved: untouched
      { id: C, llm_summary: 'summary C', side: 'a different summary' }, // disagree: untouched
      { id: D, llm_summary: null, side: null },
    ]);
  });

  it('is idempotent: a second pass over the same window clears nothing more', async () => {
    const [r] = (await c.query(nullWindowSql(['llm_summary']), [P, 10])).rows;
    expect(r).toMatchObject({ cleared: 0, disagree: 1, unmoved_holding: 1 });
  });

  it('ends the walk with a null cursor past the last key', async () => {
    const [r] = (await c.query(nullWindowSql(['llm_summary']), [D, 10])).rows;
    expect(r.next_cursor).toBeNull();
  });

  it('the mover picks up the unmoved row in its window and nothing else; the next pass clears it', async () => {
    const [m] = (await c.query(moveWindowSql(false), [P, 10])).rows;
    expect(m).toMatchObject({ next_cursor: D, scanned: 4, moved: 1 });
    const [r] = (await c.query(nullWindowSql(['llm_summary']), [P, 10])).rows;
    expect(r).toMatchObject({ cleared: 1, disagree: 1, unmoved_holding: 0 });
  });

  it('a new ingest writes the side row in the same statement, and a re-ingest does not overwrite it', async () => {
    const item = { id: E, snippet: { title: 'E', description: 'the real description', channelId: 'UCzzzzDiskGrowth',
      channelTitle: 'Z', publishedAt: '2026-09-25T10:00:00Z' }, statistics: { viewCount: '5' }, contentDetails: { duration: 'PT10M' } };
    const cls = { is_short: false, shorts_checked_at: 'now' as const };
    await c.query(videoInsertSql(), videoInsertParams(item, cls, { dataSource: 'competitor', userId: SYSTEM_USER }));
    const again = { ...item, snippet: { ...item.snippet, description: 'changed upstream' } };
    await c.query(videoInsertSql(), videoInsertParams(again, cls, { dataSource: 'competitor', userId: SYSTEM_USER }));
    const [row] = (await c.query(
      `select v.description as v_desc, vt.description as vt_desc from videos v join video_text vt on vt.video_id = v.id
        where v.id = $1`, [E])).rows;
    expect(row).toEqual({ v_desc: 'the real description', vt_desc: 'the real description' });
  });

  it('the live-broadcast metadata write leaves both copies byte-equal', async () => {
    const w = broadcastMetadataWrite({ id: E, snippet: { liveBroadcastContent: 'upcoming' },
      liveStreamingDetails: { scheduledStartTime: '2026-09-27T00:00:00Z' } })!;
    await c.query(w.sql, w.params);
    const [row] = (await c.query(
      `select v.metadata = vt.metadata as equal, vt.metadata->>'live_broadcast_content' as lbc
         from videos v join video_text vt on vt.video_id = v.id where v.id = $1`, [E])).rows;
    expect(row).toEqual({ equal: true, lbc: 'upcoming' });
  });

  it('EXPLAIN: each window statement is bounded by the primary-key window, not a table scan', async () => {
    const plan = (await c.query(`explain ${nullWindowSql(['llm_summary'])}`, ['', 5000])).rows
      .map((r) => r['QUERY PLAN']).join('\n');
    expect(plan).toMatch(/Limit/);
    expect(plan).toMatch(/videos_pkey/);
    expect(plan).not.toMatch(/Seq Scan on videos/);
  });
});
