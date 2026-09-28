// The snapshot thinning SQL against the pure policy, on a TEMPORARY table: every production row
// stays untouched. Opt-in: ALLOW_PRODUCTION_INTEGRATION_TESTS=1 npx jest --testPathIgnorePatterns /node_modules/ -- lib/readings/snapshot-retention.integration.test.ts
import dotenv from 'dotenv';
import path from 'path';
import pg from 'pg';
import { snapshotSurvivors, snapshotThinDaySql, type Snapshot } from './snapshot-retention';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
const DSN = process.env.DATABASE_SESSION_URL;
const maybe = process.env.ALLOW_PRODUCTION_INTEGRATION_TESTS === '1' && DSN ? describe : describe.skip;

maybe('snapshot thinning SQL == pure policy', () => {
  it('leaves exactly the survivors on a synthetic multi-video history', async () => {
    const c = new pg.Client({ connectionString: DSN });
    await c.connect();
    try {
      await c.query(`create temp table vs_clone (id serial primary key, video_id text, snapshot_date date,
                       view_count int, days_since_published int, unique (video_id, snapshot_date))`);
      const rows: Snapshot[] = [];
      const today = new Date();
      // Three videos, daily snapshots across ~700 days of age, the last ~400 days before today.
      for (const [vid, published] of [['a', 800], ['b', 500], ['c', 120]] as const) {
        for (let age = 0; age <= published; age += vid === 'b' ? 3 : 1) {
          const d = new Date(today.getTime() - (published - age) * 86_400_000).toISOString().slice(0, 10);
          rows.push({ video_id: vid, snapshot_date: d, days_since_published: age, view_count: age * 10 });
        }
      }
      for (const r of rows) {
        await c.query(`insert into vs_clone (video_id, snapshot_date, view_count, days_since_published) values ($1,$2,$3,$4)`,
          [r.video_id, r.snapshot_date, r.view_count, r.days_since_published]);
      }
      const days = [...new Set(rows.map((r) => r.snapshot_date))].sort();
      for (const d of days) await c.query(snapshotThinDaySql('pg_temp.vs_clone'), [d]);
      const left = (await c.query(`select video_id, snapshot_date::text as snapshot_date, days_since_published, view_count
                                     from vs_clone order by video_id, snapshot_date`)).rows;
      const expected = snapshotSurvivors(rows, today)
        .map((r) => ({ ...r })).sort((a, b) => (a.video_id + a.snapshot_date).localeCompare(b.video_id + b.snapshot_date));
      expect(left.length).toBeLessThan(rows.length);
      expect(left).toEqual(expected);
    } finally { await c.end(); }
  }, 300_000);
});
