// Applies sql/add_next_track_at.sql: adds next_track_at, indexes it, and backfills the whole
// view_tracking_priority table in batches. Idempotent — rerun to finish an interrupted backfill.
// Usage: npx tsx scripts/apply-next-track-at.ts [batchSize]
import dotenv from 'dotenv'; dotenv.config({ path: '.env.local' });
import pg from 'pg';

const BATCH = parseInt(process.argv[2] ?? '100000', 10);
// A single session client, NOT a Pool: this database is reached through the Supabase pooler,
// where a session-level `set statement_timeout` on a pooled connection does not survive to the
// next statement — which is why the first two attempts kept dying on the server's 2-minute
// default. Each batch sets it with `set local` inside its own transaction instead.
const pool = new pg.Client({ connectionString: process.env.DATABASE_URL });
await pool.connect();

// The tier-interval ladder, identical to DUE_TIER_BOUNDARIES / TIER_INTERVAL_DAYS in
// lib/nightly/due-core.ts. `base` is the video's own last read, or its publish time if it has
// never been read — so a never-read 2023 import comes out overdue, not parked in the future.
//
// KEYSET **plus** the null filter, which is what makes this finish. Either one alone is a trap:
//   - `where next_track_at is null limit N` with no cursor degrades quadratically, each batch
//     rescanning every already-filled row from the start of the heap. It died on the statement
//     timeout at 325K/1.01M rows (8s -> 124s per batch).
//   - a bare keyset walk pays the `join videos` primary-key probe for every row it steps over,
//     filled or not — measured 55s per 5,000 rows to apply 329 updates.
// The cursor stops the rescan; the null filter keeps the videos probe for rows that need it.
// PLAN NOTE. Three shapes were measured on the live table (1.01M rows, six indexes):
//   1. `where next_track_at is null limit 25000`, no cursor — 8s/batch, degrading to 124s as
//      each batch rescanned the already-filled prefix. Died on the statement timeout at 325K.
//   2. keyset on video_id with no null filter — constant, but it paid the `join videos`
//      primary-key probe for every row it stepped over: 55s per 5,000 rows for 329 updates.
//   3. keyset AND the null filter — no wasted probes, but primary-key-ordered access to the
//      heap is random: 104s per 5,000 rows, 20ms each, ~40x worse than shape 1's sequential
//      driver.
// Shape 1 wins on raw throughput; its only defect is the rescan, which is a per-BATCH cost, not
// a per-row one. So: shape 1 with a large batch and a long timeout — seven restarts instead of
// forty, and the seq scan skipping filled rows is cheap next to the probes it avoids.
const BACKFILL_SQL = `
  with b as (
    select p2.video_id,
           coalesce(p2.last_tracked::timestamptz, v.published_at) as base,
           greatest(0, floor(extract(epoch from
             (coalesce(p2.last_tracked::timestamptz, v.published_at) - v.published_at)) / 86400)) as age
      from view_tracking_priority p2
      join videos v on v.id = p2.video_id
     where p2.next_track_at is null
     limit $1
  )
  update view_tracking_priority p
     set next_track_at = b.base + (case
           when b.age <  30 then interval '1 day'
           when b.age < 180 then interval '3 days'
           when b.age < 730 then interval '7 days'
           else                  interval '14 days' end)
    from b
   where p.video_id = b.video_id`;

await pool.query(`alter table view_tracking_priority add column if not exists next_track_at timestamptz`);
console.log('column ok');
await pool.query(
  `create index concurrently if not exists idx_vtp_next_track_at
     on view_tracking_priority (next_track_at) where next_track_at is not null`
);
console.log('index ok');

let total = 0;
for (;;) {
  const t = Date.now();
  await pool.query('begin');
  await pool.query(`set local statement_timeout = '10min'`);
  const r = await pool.query(BACKFILL_SQL, [BATCH]);
  await pool.query('commit');
  if (!r.rowCount) break;
  total += r.rowCount;
  console.log(`backfilled ${total} (+${r.rowCount} in ${((Date.now() - t) / 1000).toFixed(1)}s)`);
  await new Promise((res) => setTimeout(res, 2000)); // let the disk breathe
}

const { rows } = await pool.query(
  `select count(*)::int total, count(next_track_at)::int filled,
          count(*) filter (where next_track_at <= now())::int due
     from view_tracking_priority`
);
console.log('done', rows[0]);
await pool.end();
