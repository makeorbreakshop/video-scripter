// A snapshot delete under the thinning GUC must not append to observation_change_log (the Sep 11
// egress class); without it, it must (corrections still propagate). Rolled back; opt-in:
// ALLOW_PRODUCTION_INTEGRATION_TESTS=1 npx jest --testPathIgnorePatterns /node_modules/ -- lib/readings/snapshot-thin.db.test.ts
import dotenv from 'dotenv';
import path from 'path';
import pg from 'pg';
import { THIN_SUPPRESS_DELTAS_SQL } from './sql';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
const DSN = process.env.DATABASE_SESSION_URL;
const maybe = process.env.ALLOW_PRODUCTION_INTEGRATION_TESTS === '1' && DSN ? describe : describe.skip;

maybe('view_snapshots delete propagation', () => {
  const run = async (suppress: boolean) => {
    const c = new pg.Client({ connectionString: DSN });
    await c.connect();
    try {
      await c.query('begin');
      await c.query(`set local statement_timeout = '60s'`);
      if (suppress) await c.query(THIN_SUPPRESS_DELTAS_SQL);
      const [{ id, video_id }] = (await c.query(
        `select id, video_id from view_snapshots where snapshot_date < current_date - 400 limit 1`)).rows;
      const before = Number((await c.query(`select count(*) from observation_change_log where video_id = $1`, [video_id])).rows[0].count);
      await c.query(`delete from view_snapshots where id = $1`, [id]);
      const after = Number((await c.query(`select count(*) from observation_change_log where video_id = $1`, [video_id])).rows[0].count);
      return after - before;
    } finally { await c.query('rollback').catch(() => {}); await c.end(); }
  };

  it('suppressed: no change-log row', async () => { expect(await run(true)).toBe(0); }, 60_000);
  it('not suppressed: the delete is still propagated', async () => { expect(await run(false)).toBe(1); }, 60_000);
});
