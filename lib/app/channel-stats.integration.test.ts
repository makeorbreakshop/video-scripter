// The proof that the materialised channel numbers are the numbers they replaced.
//
// packaging_change_count and last_upload_at moved out of the request path and into
// channel_stats. The risk of any precompute is that the stored number quietly stops being the
// computed one, so for a sample of real channels this refreshes the row and then recomputes both
// numbers from the source tables and requires them to be equal — not close.
//
// Against the real database; skipped without one, so CI still passes.
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { makeTimedPool } from '../admin/db';
import { refreshChannelStatsSql } from './channel-stats';
import { changedVideoCountSql } from './packaging-rows';

const d = process.env.DATABASE_URL ? describe : describe.skip;
jest.setTimeout(300_000);

/** Small: the live count is a 3-way join over each channel's catalogue, which is the point. */
const SAMPLE = Number(process.env.CHANNEL_STATS_SAMPLE ?? 5);

d('channel_stats holds the same numbers the page used to compute', () => {
  const pool = makeTimedPool({ connectionString: process.env.DATABASE_URL, max: 2, timeoutMs: 120_000 });
  const q = async (sql: string, params: any[] = []) => (await pool.query(sql, params)).rows;
  afterAll(async () => { await pool.end(); });

  it(`agrees exactly on ${SAMPLE} channels`, async () => {
    const ids = (await q(
      `select channel_id from channel_stats order by video_count desc nulls last limit $1`, [SAMPLE]
    )).map((r: any) => r.channel_id as string);
    expect(ids.length).toBeGreaterThan(0);

    await pool.query(refreshChannelStatsSql(true), [ids]);
    const stored = new Map((await q(
      `select channel_id, packaging_change_count, last_upload_at from channel_stats where channel_id = any($1::text[])`,
      [ids])).map((r: any) => [r.channel_id as string, r]));

    for (const id of ids) {
      const live = (await q(changedVideoCountSql('$1'), [id]))[0].n as number;
      expect(stored.get(id)!.packaging_change_count).toBe(live);

      const upload = (await q(
        `select max(published_at) as t from videos where channel_id = $1`, [id]))[0].t;
      const got = stored.get(id)!.last_upload_at;
      expect(got === null ? null : new Date(got).toISOString())
        .toBe(upload === null ? null : new Date(upload).toISOString());
    }
  });
});
