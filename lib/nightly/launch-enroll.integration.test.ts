// The enrollment's candidate scan must be an index-only range scan (see launch-enroll.test.ts).
// Integration test: DATABASE_URL + ALLOW_PRODUCTION_INTEGRATION_TESTS=1; plain EXPLAIN only.
import dotenv from 'dotenv';
import path from 'path';
import pg from 'pg';
import { LAUNCH_ENROLL_SQL } from './launch-enroll';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
const DSN = process.env.DATABASE_URL;
const maybe = process.env.ALLOW_PRODUCTION_INTEGRATION_TESTS === '1' && DSN ? describe : describe.skip;

maybe('launch enrollment plan', () => {
  it('scans recent videos index-only', async () => {
    const pool = new pg.Pool({ connectionString: DSN, max: 1 });
    try {
      const plan = (await pool.query(`explain ${LAUNCH_ENROLL_SQL}`)).rows.map(r => r['QUERY PLAN']).join('\n');
      expect(plan).toMatch(/Index Only Scan using videos_published_id_idx on videos/);
      // 2026-09-28: the planner hash-joined the ~600 fresh ids against a bitmap scan of 944 K
      // long-form videos (idx_videos_longtail_watch): 21 s and ~90 MB of temp spill every run,
      // 16 GB/2 days — the top spiller. Each fresh id must be fetched by primary key instead.
      expect(plan).not.toMatch(/idx_videos_longtail_watch/);
      expect(plan).not.toMatch(/Hash Join/);
      expect(plan).toMatch(/Index Scan using videos_pkey on videos/);
    } finally {
      await pool.end();
    }
  });
});
