// Rebuild channel_stats.spark for every tracked channel (lib/app/channel-sparklines.ts).
//
// The whole-list read was 89K buffers on /app/channels for a 500-channel account; done here
// once a night in batches of 25 channels with a pause between them, the page reads one row per
// channel instead. Stops before starting if the database is already busy.
//
// Usage:
//   npx tsx scripts/refresh-sparklines.ts                 # nightly
//   npx tsx scripts/refresh-sparklines.ts --limit 50      # supervised
//   npx tsx scripts/refresh-sparklines.ts --dry-run
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { makeTimedPool } from '../lib/admin/db';
import { refreshChannelSparklines } from '../lib/app/channel-sparklines';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const arg = (f: string, d?: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const DRY = has('--dry-run');
const SLEEP = Number(arg('--sleep-ms', '300'));
const LIMIT = Number(arg('--limit', '0'));
const BATCH = 25;

const pool = makeTimedPool({ connectionString: process.env.DATABASE_URL, max: 2, timeoutMs: 60_000 });
const q = async <T = any>(sql: string, params: any[] = []): Promise<T[]> => (await pool.query(sql, params)).rows as T[];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const busy = (await q<{ n: string }>(
  `select count(*)::text as n from pg_stat_activity
    where state = 'active' and now() - query_start > interval '2 minutes'
      and query not ilike '%pg_stat_activity%'`))[0];
if (Number(busy?.n ?? 0) > 0 && !has('--force')) {
  console.error('refusing to run: a query has been running over two minutes');
  await pool.end(); process.exit(2);
}

// Oldest stored line first, so an interrupted run resumes instead of redoing the front.
const ids = (await q<{ channel_id: string }>(
  `select cs.channel_id from channel_stats cs
    where cs.channel_id in (select channel_id from user_channels union select channel_id from channel_tracking)
    order by cs.spark_at nulls first ${LIMIT ? `limit ${LIMIT}` : ''}`
)).map((r) => r.channel_id);
console.log(`sparklines: ${ids.length} channel(s)${DRY ? ' [dry run]' : ''}, batch ${BATCH}, sleep ${SLEEP}ms`);

const t0 = Date.now();
let done = 0;
for (let i = 0; i < ids.length; i += BATCH) {
  const batch = ids.slice(i, i + BATCH);
  if (!DRY) await refreshChannelSparklines(batch, q);
  done += batch.length;
  if (done % 100 === 0 || done === ids.length) console.log(`  ${done}/${ids.length} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (i + BATCH < ids.length) await sleep(SLEEP);
}
console.log(`done: ${done} channel(s) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await pool.end();
