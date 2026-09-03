// Thin the rss_samples tail: past the dense window, keep one reading per video per day.
// Scheduled daily by com.mfm.video-scripter-rss-retention. Policy + SQL (pure, tested) live in
// lib/rss/retention.ts; this file is I/O only. Direct Postgres only (2026-08-31 egress rule).
// Usage: npx tsx scripts/rss-retention.ts [--dry] [--days N] [--max-batches N]
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import { RSS_RETENTION, THIN_BATCH_SQL, COUNT_OLD_SQL } from '../lib/rss/retention';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const num = (flag: string, dflt: number) => {
  const i = args.indexOf(flag);
  const v = i >= 0 ? parseInt(args[i + 1] ?? '', 10) : NaN;
  return Number.isFinite(v) ? v : dflt;
};
const days = num('--days', RSS_RETENTION.denseWindowDays);
const maxBatches = num('--max-batches', 200);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
pool.on('connect', (c: pg.PoolClient) => { c.query('set statement_timeout = 300000').catch(() => {}); });
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

const before = await pool.query(COUNT_OLD_SQL, [days]);
log(`rss_samples older than ${days} days: ${before.rows[0].n}`);

if (dry) {
  log('--dry: nothing deleted');
} else {
  let deleted = 0;
  for (let i = 0; i < maxBatches; i++) {
    const res = await pool.query(THIN_BATCH_SQL, [days, RSS_RETENTION.batchSize]);
    const n = res.rowCount ?? 0;
    deleted += n;
    if (n < RSS_RETENTION.batchSize) break;
    log(`thinned ${deleted} rows so far`);
  }
  log(`done: ${deleted} rows deleted (one reading per video per day kept past ${days} days)`);
}

await pool.end();
