// Materialisation cadence by video age (2026-09-28). Every reading marked its video for a full
// obs-blob rewrite within 5 minutes; the materializer returned ~5.7 GB/day of cached blobs to the
// client (billable shared-pooler egress) and the rewrites were ~40 % of all WAL. Now a mark waits
// least(score cadence, 6 h): videos under a day old still materialise within 5 minutes, and no
// video's cache refreshes less often than its score does (the scorer can only score a video whose
// cache covers its latest change). Rolled back; opt-in:
// ALLOW_PRODUCTION_INTEGRATION_TESTS=1 npx jest --testPathIgnorePatterns /node_modules/ -- lib/scoring/materialization-cadence.integration.test.ts
import dotenv from 'dotenv';
import path from 'path';
import pg from 'pg';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
const DSN = process.env.DATABASE_SESSION_URL;
const maybe = process.env.ALLOW_PRODUCTION_INTEGRATION_TESTS === '1' && DSN ? describe : describe.skip;

maybe('obs_cache_dirty.not_before follows the video\'s age', () => {
  it.each([
    ['2 hours old', '2 hours', 0, 10],
    ['3 days old (score hourly)', '3 days', 55, 65],
    ['20 days old (capped at 6 h)', '20 days', 355, 365],
  ])('%s', async (_label, age, minMinutes, maxMinutes) => {
    const c = new pg.Client({ connectionString: DSN });
    await c.connect();
    try {
      await c.query('begin');
      await c.query(`set local statement_timeout = '60s'`);
      const id = `zzCadence${age.replace(/\s/g, '')}`;
      await c.query(`insert into videos (id, channel_id, title, published_at, view_count, user_id)
                     values ($1, 'UCzzCadence', 't', now() - $2::interval, 0, '00000000-0000-0000-0000-000000000000')`, [id, age]);
      await c.query(`delete from obs_cache_dirty where video_id = $1`, [id]);
      await c.query(`insert into rss_samples (video_id, at, views) values ($1, now(), 10)`, [id]);
      const [row] = (await c.query(
        `select extract(epoch from not_before - now()) / 60 as minutes from obs_cache_dirty where video_id = $1`, [id])).rows;
      expect(Number(row.minutes)).toBeGreaterThanOrEqual(minMinutes);
      expect(Number(row.minutes)).toBeLessThanOrEqual(maxMinutes);
    } finally { await c.query('rollback').catch(() => {}); await c.end(); }
  }, 60_000);
});
