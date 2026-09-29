// The versioned rss_response_state read against production, inside a rolled-back transaction:
// a held md5 returns no jsonb, a missing one returns the state. Two rows, ~5 KB.
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import { RESPONSE_STATE_READ_VERSIONED_SQL } from './response-store';

const d = process.env.ALLOW_PRODUCTION_INTEGRATION_TESTS === '1' && process.env.DATABASE_URL ? describe : describe.skip;
jest.setTimeout(60_000);

d('RESPONSE_STATE_READ_VERSIONED_SQL', () => {
  it('returns the state only when the held md5 differs', async () => {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query('begin');
      await client.query("set local lock_timeout = '2s'");
      const ids = (await client.query(`select channel_id from rss_response_state where state is not null
                                         order by channel_id limit 2`)).rows.map((r) => r.channel_id);
      const cold = (await client.query(RESPONSE_STATE_READ_VERSIONED_SQL, [ids, [null, null]])).rows;
      expect(cold.every((r) => r.state && /^[0-9a-f]{32}$/.test(r.version))).toBe(true);
      const warm = (await client.query(RESPONSE_STATE_READ_VERSIONED_SQL, [ids, [cold[0].version, 'stale']])).rows;
      expect(warm[0].state).toBeNull();
      expect(warm[1].state).toEqual(cold[1].state);
    } finally {
      await client.query('rollback').catch(() => {});
      await client.end();
    }
  });
});
