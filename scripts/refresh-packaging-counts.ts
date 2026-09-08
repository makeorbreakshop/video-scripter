// Keep channel_stats.packaging_change_count and .last_upload_at true, one channel at a time.
//
// The count is a 3-way join over a channel's whole catalogue. It is cheap enough per channel and
// far too expensive for all 500 in one statement (~8 GB of buffer traffic against a 512 MB
// pool), which is why the unscoped refreshChannelStats deliberately leaves the column alone and
// this job owns it instead: bounded reads, a sleep between them, and it stops if the database is
// already busy.
//
// Usage:
//   npx tsx scripts/refresh-packaging-counts.ts --dry-run
//   npx tsx scripts/refresh-packaging-counts.ts --sleep-ms 400        # nightly
//   npx tsx scripts/refresh-packaging-counts.ts --limit 20            # supervised
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { makeTimedPool } from '../lib/admin/db';
import { changedVideoCountSql } from '../lib/app/packaging-rows';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const arg = (f: string, d?: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const DRY = has('--dry-run') || has('--dry');
const SLEEP = Number(arg('--sleep-ms', '400'));
const LIMIT = Number(arg('--limit', '0'));

const pool = makeTimedPool({ connectionString: process.env.DATABASE_URL, max: 2, timeoutMs: 60_000 });
const q = async <T = any>(sql: string, params: any[] = []): Promise<T[]> => (await pool.query(sql, params)).rows as T[];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function heavy(): Promise<string | null> {
  const rows = await q<{ n: string }>(
    `select count(*)::text as n from pg_stat_activity
      where state = 'active' and now() - query_start > interval '2 minutes'
        and query not ilike '%pg_stat_activity%'`);
  return Number(rows[0]?.n ?? 0) > 0 ? 'a query has been running over two minutes' : null;
}

const stop = await heavy();
if (stop && !has('--force')) { console.error(`refusing to run: ${stop}`); await pool.end(); process.exit(2); }

// The tracked set, not every channel_stats row: 6,500 channels have a stats row but only the
// ~500 someone tracks are ever rendered, and at ~1 s a channel the difference is two hours
// against six minutes. Oldest first, so an interrupted run resumes rather than redoing the front.
const channels = (await q<{ channel_id: string }>(
  `select cs.channel_id from channel_stats cs
    where cs.channel_id in (select channel_id from user_channels
                            union select channel_id from channel_tracking)
    order by cs.packaging_change_count is not null, cs.updated_at nulls first
    ${LIMIT ? `limit ${LIMIT}` : ''}`
)).map((r) => r.channel_id);
console.log(`packaging counts: ${channels.length} channel(s)${DRY ? ' [dry run]' : ''}, sleep ${SLEEP}ms`);

let changed = 0;
const t0 = Date.now();
for (const [i, id] of channels.entries()) {
  const n = (await q<{ n: number }>(changedVideoCountSql('$1'), [id]))[0]?.n ?? 0;
  // last_upload_at rides along: one backward probe on idx_videos_channel_published, and this is
  // the job that owns keeping the channel list off the videos table.
  const up = (await q<{ t: string | null }>(
    `select v.published_at as t from videos v
      where v.channel_id = $1 and v.published_at is not null
      order by v.published_at desc limit 1`, [id]))[0]?.t ?? null;
  if (!DRY) {
    const r = await q(
      `update channel_stats set packaging_change_count = $2, last_upload_at = $3::timestamptz
        where channel_id = $1
          and (packaging_change_count is distinct from $2 or last_upload_at is distinct from $3::timestamptz)
        returning channel_id`, [id, n, up]);
    changed += r.length;
  }
  if (i % 25 === 0) {
    const busy = await heavy();
    if (busy && !has('--force')) { console.error(`stopping early: ${busy} (${i}/${channels.length} — rerun to resume)`); break; }
    console.log(`  ${i + 1}/${channels.length} · ${changed} changed · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  await sleep(SLEEP);
}
console.log(`done: ${changed} row(s) changed, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
await pool.end();
