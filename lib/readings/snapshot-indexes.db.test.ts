// view_snapshots carried 701 MB of indexes on a 307 MB heap (2026-09-26), including two btrees on
// the same (video_id, snapshot_date): the unique constraint and a DESC copy with INCLUDE columns.
// One unique covering index does both jobs (ON CONFLICT arbiter + index-only latest-snapshot reads).
// idx_view_snapshots_date stays: dropping it made the daily rollup 7.1× slower on 2026-09-14.
// Opt-in: ALLOW_PRODUCTION_INTEGRATION_TESTS=1 npx jest --testPathIgnorePatterns /node_modules/ -- lib/readings/snapshot-indexes.db.test.ts
import dotenv from 'dotenv';
import path from 'path';
import pg from 'pg';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
const DSN = process.env.DATABASE_URL;
const maybe = process.env.ALLOW_PRODUCTION_INTEGRATION_TESTS === '1' && DSN ? describe : describe.skip;

const HOT_READS: [string, string, unknown[]][] = [
  ['latest snapshot per video (183 K calls)',
   `select distinct on (video_id) video_id, view_count, snapshot_date::text from view_snapshots
     where video_id = any($1) and snapshot_date < current_date order by video_id, snapshot_date desc`, [['dQw4w9WgXcQ', 'jNQXAC9IVRw']]],
  ['day-N snapshot near an age (31 K calls)',
   `select distinct on (video_id) video_id, view_count from view_snapshots
     where video_id = any($1) and days_since_published between $2 and $3 and view_count > $4
     order by video_id, abs(days_since_published - $5)`, [['dQw4w9WgXcQ'], 20, 40, 0, 30]],
  ['all snapshots of a video (charts, scorer raw read)',
   `select video_id, snapshot_date, view_count from view_snapshots where video_id = any($1::text[]) order by video_id, snapshot_date`, [['dQw4w9WgXcQ']]],
];

maybe('view_snapshots indexes', () => {
  let pool: pg.Pool;
  beforeAll(() => { pool = new pg.Pool({ connectionString: DSN, max: 1 }); });
  afterAll(async () => { await pool?.end(); });

  it('has exactly one btree led by (video_id, snapshot_date), unique, covering view_count', async () => {
    const rows = (await pool.query(`select indexrelid::regclass::text as name, pg_get_indexdef(indexrelid) as def, indisunique
                                      from pg_index where indrelid = 'view_snapshots'::regclass`)).rows;
    const led = rows.filter((r) => /\(video_id, snapshot_date( DESC)?\)/.test(r.def));
    expect(led.map((r) => r.name)).toHaveLength(1);
    expect(led[0].indisunique).toBe(true);
    expect(led[0].def).toMatch(/INCLUDE \(view_count, like_count, comment_count\)/);
    expect(rows.map((r) => r.name)).toContain('idx_view_snapshots_date');
  });

  it.each(HOT_READS)('%s is served by an index, never a sequential scan', async (_label, sql, params) => {
    const plan = (await pool.query(`explain ${sql}`, params)).rows.map((r) => r['QUERY PLAN']).join('\n');
    expect(plan).not.toMatch(/Seq Scan on view_snapshots/);
    expect(plan).toMatch(/Index (Only )?Scan.* on view_snapshots/);
  });
});
