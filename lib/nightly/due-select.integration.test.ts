// Integration guard for the due-based tracker's hot path. Skipped without DATABASE_URL.
//
// The drain runs every 15 minutes forever, so the due-select must stay an index-ordered scan
// over idx_vtp_next_track_at with the LIMIT as its cost — NOT a sort of the whole overdue
// backlog, which at ~900K rows would be an IO spike on a database that has had incidents.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { DUE_SELECT_SQL } from './due-core';

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

d('due-select against the real database', () => {
  let pool: any;
  beforeAll(async () => {
    const pg = require('pg');
    pool = new pg.Pool({ connectionString: url, max: 1 });
  });
  afterAll(async () => { await pool?.end(); });

  it('returns a tick-sized due batch in under 500ms', async () => {
    const t = Date.now();
    const res = await pool.query(DUE_SELECT_SQL, [3100]); // one tick at the 6000/day budget
    const ms = Date.now() - t;
    expect(res.rows.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(500);
  }, 30_000);

  it('is index-ordered, not a full sort of the backlog', async () => {
    const res = await pool.query(`explain (analyze, buffers) ${DUE_SELECT_SQL}`, [3100]);
    const plan = res.rows.map((r: any) => r['QUERY PLAN']).join('\n');
    expect(plan).toMatch(/idx_vtp_next_track_at/);
    expect(plan).not.toMatch(/Seq Scan on view_tracking_priority/);
  }, 30_000);

  it('hands back the oldest-due videos first', async () => {
    const res = await pool.query(DUE_SELECT_SQL, [200]);
    const q = await pool.query(
      `select next_track_at from view_tracking_priority where video_id = any($1) order by next_track_at`,
      [res.rows.map((r: any) => r.video_id)]
    );
    const max = new Date(q.rows[q.rows.length - 1].next_track_at).getTime();
    const { rows } = await pool.query(
      `select count(*)::int n from view_tracking_priority where next_track_at < $1`,
      [new Date(max).toISOString()]
    );
    // Nothing older than the batch's newest member was skipped over.
    expect(rows[0].n).toBeLessThanOrEqual(200);
  }, 30_000);
});
