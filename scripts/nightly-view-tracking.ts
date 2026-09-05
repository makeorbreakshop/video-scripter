// Nightly view tracking over the DIRECT Postgres connection (unmetered).
// Replaces the supabase-js path after the 2026-08-31 egress incident.
// Usage: npx tsx scripts/nightly-view-tracking.ts [maxApiCalls] [--catalog N]
//
// Two passes:
//   1. the DUE list, priority_tier asc, capped at maxApiCalls*50 (tiers 0-2 fill it every night)
//   2. the CATALOG SLICE (--catalog N, default 15000): a reserved read of the OLDEST-READ
//      tier>=3 archive. Without it the 678K videos older than ~2 years keep the single
//      Jul/Aug 2025 snapshot they were imported with, and lib/scoring/core.ts fitLongTail has
//      no support past 365 days. See lib/nightly/tracking-core.ts for the selection logic.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import {
  buildSnapshotRows, chunk, TrackedVideo, PrevSnapshot,
  selectCatalogSlice, catalogCycleDays, catalogNextTrackDate,
  CATALOG_MIN_TIER, CATALOG_CANDIDATES_SQL, CATALOG_POOL_SQL,
  RSS_ROLL_SQL, rssRollRows, type RssRollRow,
} from '../lib/nightly/tracking-core';
import { withDeadlockRetry } from '../lib/nightly/pg-retry';

const argv = process.argv.slice(2);
// First BARE numeric argument is the main cap. `0` is honoured (catalog-only run), so this
// cannot use `|| default` on the raw string.
const bareNum = argv.find((a, i) => /^\d+$/.test(a) && !argv[i - 1]?.startsWith('--'));
const maxApiCalls = bareNum === undefined ? 2000 : parseInt(bareNum, 10);
const catalogArg = argv.includes('--catalog')
  ? parseInt(argv[argv.indexOf('--catalog') + 1] ?? '', 10)
  : NaN;
const catalogSize = Number.isFinite(catalogArg) ? catalogArg : 15000;
const API_KEY = process.env.YOUTUBE_API_KEY!;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

const today = new Date().toISOString().split('T')[0];

// Pass 0: videos the RSS poller already read today need no API call. Their latest feed
// reading becomes tonight's snapshot (never overwriting an API reading for the same day) and
// they are parked on their tier cadence, so the due list below no longer contains them.
{
  const t0 = Date.now();
  const rss = await pool.query<RssRollRow>(RSS_ROLL_SQL, [today]);
  const rows = rssRollRows(rss.rows, today);
  for (const group of chunk(rows, 2000)) {
    await withDeadlockRetry(async () => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const values: any[] = []; const tuples: string[] = [];
        group.forEach((r, i) => {
          values.push(r.video_id, r.snapshot_date, r.view_count, r.like_count, r.comment_count, r.days_since_published, r.daily_views_rate);
          const b = i * 7; tuples.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`);
        });
        await client.query(
          `insert into view_snapshots (video_id, snapshot_date, view_count, like_count, comment_count, days_since_published, daily_views_rate)
           values ${tuples.join(',')} on conflict (video_id, snapshot_date) do nothing`, values);
        await client.query(
          `update view_tracking_priority p set last_tracked = $1, next_track_date = x.next_track_date, updated_at = now()
             from (select unnest($2::text[]) as video_id, unnest($3::date[]) as next_track_date) x
            where p.video_id = x.video_id`,
          [today, group.map((r) => r.video_id), group.map((r) => r.next_track_date)]);
        await client.query('commit');
      } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
    });
  }
  console.log(`rss: ${rows.length} due videos covered by today's feed readings (0 units) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

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
let mainBucketCalls = 0;
let written = 0;

interface BatchRow { video_id: string; priority_tier: number; days_since_published: number | null }

/**
 * Read one batch of <=50 ids and write their snapshots. `overrideNextTrackDate` is what the
 * catalogue pass uses to park a video a full rotation out instead of on its tier cadence.
 * Returns false when the API failed and the caller should stop.
 */
async function processBatch(batch: BatchRow[], overrideNextTrackDate?: string): Promise<boolean> {
  const ids = batch.map((r) => r.video_id);
  // videos:batchGetStats lives in its own 10K-unit daily bucket (June 2026),
  // keeping the main quota pool free for ingest/discovery. Fallback to
  // videos.list (main bucket) if the endpoint ever misbehaves.
  let res = await fetch(
    `https://www.googleapis.com/youtube/v3/videos:batchGetStats?part=statistics&id=${ids.join(',')}&key=${API_KEY}`
  );
  if (!res.ok && res.status !== 403) {
    res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids.join(',')}&key=${API_KEY}`
    );
    mainBucketCalls++;
  }
  apiCalls++;
  if (!res.ok) {
    console.error(`YouTube API error ${res.status}; stopping.`);
    return false;
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

  const built = buildSnapshotRows(data.items || [], tracked, prev, today);
  const rows = overrideNextTrackDate
    ? built.map((r) => ({ ...r, next_track_date: overrideNextTrackDate }))
    : built;
  if (rows.length === 0) return true;
  // Deterministic lock order across concurrent writers (launch-track, drain).
  rows.sort((a, b) => (a.video_id < b.video_id ? -1 : a.video_id > b.video_id ? 1 : 0));

  // Retry the whole batch transaction on deadlock (40P01) instead of dying —
  // the 2026-09-02 03:30 run exited after 33 snapshots on one deadlock.
  await withDeadlockRetry(async () => {
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
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  });
  return true;
}

for (const batch of chunk(due.rows as BatchRow[], 50)) {
  if (!(await processBatch(batch))) break;
  if (written % 5000 < 50) console.log(`Progress: ${written} snapshots, ${apiCalls} API calls`);
}
const dueWritten = written;
const dueCalls = apiCalls;

// ---------------------------------------------------------------- catalog slice
let catalogVideos = 0;
if (catalogSize > 0) {
  const [poolRes, candRes] = await Promise.all([
    pool.query(CATALOG_POOL_SQL, [CATALOG_MIN_TIER]),
    // Ask for a little more than we need so selectCatalogSlice, not the LIMIT, decides.
    pool.query(CATALOG_CANDIDATES_SQL, [CATALOG_MIN_TIER, catalogSize + 100]),
  ]);
  const poolSize = poolRes.rows[0]?.n ?? 0;
  const slice = selectCatalogSlice(candRes.rows, catalogSize);
  const parkUntil = catalogNextTrackDate(today, catalogCycleDays(poolSize, catalogSize));
  console.log(
    `catalog: selecting ${slice.length} of ${poolSize} tier>=${CATALOG_MIN_TIER} videos ` +
    `(oldest read ${slice[0]?.last_tracked ?? 'never'}), parking until ${parkUntil}`
  );
  for (const batch of chunk(slice as unknown as BatchRow[], 50)) {
    if (!(await processBatch(batch, parkUntil))) break;
    catalogVideos = written - dueWritten;
    if (catalogVideos % 5000 < 50) console.log(`Catalog progress: ${catalogVideos} snapshots`);
  }
  catalogVideos = written - dueWritten;
  console.log(`catalog: ${catalogVideos} videos, ${apiCalls - dueCalls} calls`);
}

await pool.query(
  `insert into youtube_quota_usage (date, quota_used) values (current_date, $1)
   on conflict (date) do update set quota_used = youtube_quota_usage.quota_used + $1`,
  [mainBucketCalls]
).catch((e) => console.warn('quota log skipped:', e.message));
await pool.query(`insert into quota_ledger (category, units) values ('snapshots-batch', $1)`, [apiCalls - mainBucketCalls]).catch(() => {});
await pool.query(`insert into quota_ledger (category, units) values ('snapshots', $1)`, [mainBucketCalls]).catch(() => {});

console.log(`Done. ${written} snapshots written (${dueWritten} due, ${catalogVideos} catalog), ${apiCalls} calls (${apiCalls - mainBucketCalls} batch-bucket, ${mainBucketCalls} main-bucket).`);
await pool.end();
