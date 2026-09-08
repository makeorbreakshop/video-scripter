// Fill video_obs_cache for the videos the scorer actually divides by.
//
// The set that matters is not "every video": it is the PRIORS of everything that gets scored —
// the recent long-form videos of every tracked channel. Those are what loadRecords reads sixteen
// at a time, every hour. Anything else can stay a cache miss for ever at no cost.
//
// This is the one job in this change that reads the three big tables in bulk, so it is throttled
// on purpose: small batches, a sleep between them, and it stops on its own if anything heavy
// shows up in pg_stat_activity. Resumable — it skips videos that already have a fresh row — so
// an aborted run costs nothing.
//
// Usage:
//   npx tsx scripts/backfill-obs-cache.ts --dry-run
//   npx tsx scripts/backfill-obs-cache.ts --batch 200 --sleep-ms 500        # nightly: no --limit
//   npx tsx scripts/backfill-obs-cache.ts --limit 2000                      # supervised sample
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { makeTimedPool } from '../lib/admin/db';
import { OBSERVATION_RECORDS_SQL, observationRecords } from '../lib/scoring/observations';
import { OBS_CACHE_DDL, OBS_CACHE_UPSERT_SQL, encodeObservations } from '../lib/scoring/obs-cache';
import { PRIOR_WINDOW } from '../lib/scoring/core';
import { longformSql } from '../lib/scoring/longform';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const arg = (f: string, d?: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };

const DRY = has('--dry-run') || has('--dry');
const BATCH = Number(arg('--batch', '200'));
const SLEEP = Number(arg('--sleep-ms', '500'));
const LIMIT = Number(arg('--limit', '0'));
/** A row older than this is rebuilt; younger ones are left alone so a rerun is cheap. */
const FRESH_HOURS = Number(arg('--fresh-hours', '48'));

const pool = makeTimedPool({ connectionString: process.env.DATABASE_URL, max: 2, timeoutMs: 60_000 });
const q = async <T = any>(sql: string, params: any[] = []): Promise<T[]> => (await pool.query(sql, params)).rows as T[];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Same preflight as rebuild-series.ts: never add load to a database that is already struggling. */
async function heavy(): Promise<string | null> {
  const rows = await q<{ n: string }>(
    `select count(*)::text as n from pg_stat_activity
      where state = 'active' and now() - query_start > interval '2 minutes'
        and query not ilike '%pg_stat_activity%'`);
  return Number(rows[0]?.n ?? 0) > 0 ? 'a query has been running over two minutes' : null;
}

/**
 * The candidate priors of ONE channel: its most recent PRIOR_WINDOW * 2 public long-form videos.
 * Doubled because the window slides — today's target is tomorrow's prior.
 *
 * Deliberately per channel. The all-channels form of this query is one statement that touches
 * ~52,000 `videos` heap blocks (measured: 77 s, 41K of them off disk) because the long-form and
 * privacy predicates are not in idx_videos_channel_published_longform and every candidate row
 * has to be fetched from a table whose rows are 2 KB wide. Split per channel it is the same
 * total work spread over 500 bounded reads that can be paced and interrupted, which is the only
 * shape this job is allowed to have on this instance.
 */
const CHANNEL_CANDIDATES_SQL = `
  select p.id
    from (select $1::text as channel_id) c
    join lateral (
      select v.id from videos v
       where v.channel_id = c.channel_id and v.published_at is not null
         and ${longformSql('v')}
         and coalesce(v.privacy_status,'public') = 'public' and coalesce(v.view_count,0) > 0
       order by v.published_at desc limit ${PRIOR_WINDOW * 2}
    ) p on true
    left join video_obs_cache o on o.video_id = p.id
   where o.video_id is null or o.built_at < now() - interval '${FRESH_HOURS} hours'`;

const stop = await heavy();
if (stop && !has('--force')) { console.error(`refusing to run: ${stop}`); await pool.end(); process.exit(2); }

await pool.query(OBS_CACHE_DDL);
// --channels narrows a supervised run to a named set; the nightly run takes them all.
const only = (arg('--channels', '') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const channels = only.length ? only : (await q<{ channel_id: string }>(
  `select distinct channel_id from channel_tracking order by channel_id`)).map((r) => r.channel_id);
console.log(`obs-cache backfill: ${channels.length} channel(s)${DRY ? ' [dry run]' : ''}, batch ${BATCH}, sleep ${SLEEP}ms`);

let done = 0, points = 0, bytes = 0, seen = 0;
const t0 = Date.now();
outer:
for (const [ci, channelId] of channels.entries()) {
  const ids = (await q<{ id: string }>(CHANNEL_CANDIDATES_SQL, [channelId])).map((r) => r.id);
  seen += ids.length;
  for (let i = 0; i < ids.length; i += BATCH) {
    const part = ids.slice(i, i + BATCH);
    const byVideo = observationRecords(await q(OBSERVATION_RECORDS_SQL, [part]));
    const [n, buf] = [[] as number[], [] as Buffer[]];
    for (const id of part) {
      const pts = byVideo.get(id) ?? [];
      n.push(pts.length); buf.push(encodeObservations(pts));
      points += pts.length;
    }
    bytes += buf.reduce((s, b) => s + b.length, 0);
    if (!DRY) await pool.query(OBS_CACHE_UPSERT_SQL, [part, n, buf]);
    done += part.length;
    await sleep(SLEEP);
  }
  if (LIMIT && done >= LIMIT) { console.log(`--limit ${LIMIT} reached`); break; }
  if (ci % 20 === 0) {
    const busy = await heavy();
    if (busy && !has('--force')) { console.error(`stopping early: ${busy} (${ci}/${channels.length} channels — rerun to resume)`); break outer; }
    console.log(`  channel ${ci + 1}/${channels.length} · ${done} row(s) · ${(bytes / 1e6).toFixed(1)} MB · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}

console.log(`done: ${done}/${seen} row(s), ${points} observation(s), ${(bytes / 1e6).toFixed(1)} MB, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log(`mean ${done ? Math.round(bytes / done) : 0} bytes/row`);
await pool.end();
