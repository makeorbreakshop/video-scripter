// Nightly view tracking over the DIRECT Postgres connection (unmetered).
// Replaces the supabase-js path after the 2026-08-31 egress incident.
// Usage: npx tsx scripts/nightly-view-tracking.ts [maxApiCalls]
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import { buildSnapshotRows, chunk, TrackedVideo, PrevSnapshot } from '../lib/nightly/tracking-core';

const maxApiCalls = parseInt(process.argv[2] || '2000', 10);
const API_KEY = process.env.YOUTUBE_API_KEY!;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

const today = new Date().toISOString().split('T')[0];

const due = await pool.query(
  `select p.video_id, p.priority_tier,
          (current_date - v.published_at::date) as days_since_published
   from view_tracking_priority p
   join videos v on v.id = p.video_id
   where p.next_track_date is null or p.next_track_date <= $1
   order by p.priority_tier asc, p.last_tracked asc nulls first
   limit $2`,
  [today, maxApiCalls * 50]
);
console.log(`Videos due for tracking: ${due.rows.length} (cap ${maxApiCalls * 50})`);

let apiCalls = 0;
let written = 0;
for (const batch of chunk(due.rows, 50)) {
  const ids = batch.map((r) => r.video_id);
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids.join(',')}&key=${API_KEY}`
  );
  apiCalls++;
  if (!res.ok) {
    console.error(`YouTube API error ${res.status}; stopping.`);
    break;
  }
  const data: any = await res.json();

  const tracked = new Map<string, TrackedVideo>(
    batch.map((r) => [r.video_id, { priority_tier: r.priority_tier, days_since_published: r.days_since_published }])
  );
  const prevRes = await pool.query(
    `select distinct on (video_id) video_id, view_count, snapshot_date::text
     from view_snapshots where video_id = any($1) and snapshot_date < $2
     order by video_id, snapshot_date desc`,
    [ids, today]
  );
  const prev = new Map<string, PrevSnapshot>(
    prevRes.rows.map((r) => [r.video_id, { view_count: r.view_count, snapshot_date: r.snapshot_date }])
  );

  const rows = buildSnapshotRows(data.items || [], tracked, prev, today);
  if (rows.length === 0) continue;

  const client = await pool.connect();
  try {
    await client.query('begin');
    const values: any[] = [];
    const tuples = rows
      .map((r, i) => {
        values.push(r.video_id, r.snapshot_date, r.view_count, r.like_count, r.comment_count, r.days_since_published, r.daily_views_rate);
        const b = i * 7;
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`;
      })
      .join(',');
    await client.query(
      `insert into view_snapshots (video_id, snapshot_date, view_count, like_count, comment_count, days_since_published, daily_views_rate)
       values ${tuples}
       on conflict (video_id, snapshot_date) do update set
         view_count = excluded.view_count, like_count = excluded.like_count,
         comment_count = excluded.comment_count, daily_views_rate = excluded.daily_views_rate`,
      values
    );
    for (const r of rows) {
      await client.query(
        `update view_tracking_priority set last_tracked=$1, next_track_date=$2, updated_at=now() where video_id=$3`,
        [today, r.next_track_date, r.video_id]
      );
    }
    await client.query(
      `insert into youtube_quota_calls (date, method, cost, description)
       values (current_date, 'videos.list', 1, 'nightly view tracking (direct pg)')
       on conflict do nothing`
    ).catch(() => {});
    await client.query('commit');
    written += rows.length;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
  if (written % 5000 < 50) console.log(`Progress: ${written} snapshots, ${apiCalls} API calls`);
}

await pool.query(
  `insert into youtube_quota_usage (date, quota_used) values (current_date, $1)
   on conflict (date) do update set quota_used = youtube_quota_usage.quota_used + $1`,
  [apiCalls]
).catch((e) => console.warn('quota log skipped:', e.message));

console.log(`Done. ${written} snapshots written, ${apiCalls} YouTube API units used.`);
await pool.end();
