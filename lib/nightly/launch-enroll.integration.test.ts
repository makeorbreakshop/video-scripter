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
    } finally {
      await pool.end();
    }
  });
});
