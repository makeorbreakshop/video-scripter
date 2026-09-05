// Applies sql/add_next_track_at.sql: adds next_track_at, indexes it, and backfills the whole
// view_tracking_priority table in batches. Idempotent — rerun to finish an interrupted backfill.
// Usage: npx tsx scripts/apply-next-track-at.ts [batchSize]
import dotenv from 'dotenv'; dotenv.config({ path: '.env.local' });
import pg from 'pg';

const BATCH = parseInt(process.argv[2] ?? '25000', 10);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

// The tier-interval ladder, identical to DUE_TIER_BOUNDARIES / TIER_INTERVAL_DAYS in
// lib/nightly/due-core.ts. `base` is the video's own last read, or its publish time if it has
// never been read — so a never-read 2023 import comes out overdue, not parked in the future.
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
  const r = await pool.query(BACKFILL_SQL, [BATCH]);
  if (r.rowCount === 0) break;
  total += r.rowCount;
  console.log(`backfilled ${total} (+${r.rowCount} in ${((Date.now() - t) / 1000).toFixed(1)}s)`);
  await new Promise((res) => setTimeout(res, 1500)); // let the disk breathe
}
const { rows } = await pool.query(
  `select count(*)::int total, count(next_track_at)::int filled,
          count(*) filter (where next_track_at <= now())::int due
     from view_tracking_priority`
);
console.log('done', rows[0]);
await pool.end();
