// The storage contract against the live catalog. Fails when a table over the threshold has no
// declared policy, exceeds its budget, or is mostly free space.
//
// Opt-in (reads production): ALLOW_PRODUCTION_INTEGRATION_TESTS=1 npx jest --testPathIgnorePatterns /node_modules/ -- lib/ops/storage-contract.db.test.ts
// Catalog-only: one statement over pg_class/pg_stats, ≤ 300 small rows. The same evaluation runs
// daily in scripts/storage-guard.ts, which alerts instead of failing.
import dotenv from 'dotenv';
import path from 'path';
import pg from 'pg';
import { CATALOG_SIZES_SQL, evaluateContracts, rowToRelation } from './storage-contract';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
const DSN = process.env.DATABASE_URL;
const maybe = process.env.ALLOW_PRODUCTION_INTEGRATION_TESTS === '1' && DSN ? describe : describe.skip;

maybe('the live database honours its storage contract', () => {
  it('has no undeclared, over-budget or heavily bloated table', async () => {
    const pool = new pg.Pool({ connectionString: DSN, max: 1 });
    try {
      const c = await pool.connect();
      try {
        await c.query(`begin read only`);
        await c.query(`set local statement_timeout = '20s'`);
        const rows = (await c.query(CATALOG_SIZES_SQL)).rows.map(rowToRelation);
        await c.query('commit');
        expect(rows.length).toBeGreaterThan(10);
        expect(evaluateContracts(rows).map((v) => v.message)).toEqual([]);
      } finally { c.release(); }
    } finally { await pool.end(); }
  }, 60_000);
});
