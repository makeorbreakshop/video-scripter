// The due-based view tracker. One tick of a continuously drained queue; run every 15 minutes
// from scripts/track-drain.ts. Replaces the 3 AM scripts/nightly-view-tracking.ts.
//
// Brandon, 2026-09-05: "Why is the run at 3 am? These should get triggered as they need to by
// when they were released, and we batch so it's efficient."
//
// Each tick:
//   0. DUE SLICE   — everything with next_track_at <= now(), OLDEST-DUE FIRST so nothing
//      starves, over-fetched a few times past what the budget can pay for.
//   1. RSS ROLL-IN — any video in that slice the free channel-feed poller has read in the last
//      20h gets that reading as its snapshot. Zero quota, and it never reaches the API.
//   2. DUE READ    — the rest, in 50-id calls, up to this tick's slice of the day's quota
//      (see tickBudget). Whatever does not fit stays due for the next tick.
//   3. ARCHIVE     — no separate pass any more. Tier 4 (fortnightly) is scheduled by the same
//      next_track_at as everything else and reaches the head of the oldest-due ordering on its
//      own, which is what the old --catalog slice was hand-rolling.
//
// The tick stops at TICK_SOFT_DEADLINE_MS (5 min) so it can never overrun the 15-min interval.
//
// Usage: npx tsx scripts/track-due.ts [--budget N] [--dry-run]
// Same egress rule as tracking-core: direct Postgres only, never the Supabase REST API.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import {
  DUE_SELECT_SQL, RSS_FOR_DUE_SQL, buildDueRows, rssRollDueRows, partitionDue, dueFetchCap,
  tickBudget, ticksLeftInDay, idCapForBudget,
  TRACK_DUE_DAILY_BUDGET, TICK_INTERVAL_MIN, TICK_SOFT_DEADLINE_MS, IDS_PER_CALL,
  type DueRow, type DueSnapshotRow, type RssReading,
} from '../lib/nightly/due-core';
import { chunk } from '../lib/nightly/tracking-core';
import { withDeadlockRetry } from '../lib/nightly/pg-retry';

const argv = process.argv.slice(2);
const budgetArg = argv.includes('--budget') ? parseInt(argv[argv.indexOf('--budget') + 1] ?? '', 10) : NaN;
const DAILY_BUDGET = Number.isFinite(budgetArg) ? budgetArg : TRACK_DUE_DAILY_BUDGET;
const DRY_RUN = argv.includes('--dry-run');

const API_KEY = process.env.YOUTUBE_API_KEY!;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const started = Date.now();
const now = new Date();
const elapsed = () => Date.now() - started;
const outOfTime = () => elapsed() > TICK_SOFT_DEADLINE_MS;

// ---------------------------------------------------------------- budget for this tick
// What tracking has already spent today, from the same ledger the nightly wrote to, so a
// restart or a manual run cannot double-spend the day.
const spent = (await pool.query<{ n: number }>(
  `select coalesce(sum(cost), 0)::int as n from youtube_quota_calls
    where date = current_date and description like 'track-due%'`
)).rows[0].n;
const ticksLeft = ticksLeftInDay(now, TICK_INTERVAL_MIN);
const budget = tickBudget(spent, DAILY_BUDGET, ticksLeft);
const idCap = idCapForBudget(budget);
console.log(
  `budget: ${spent}/${DAILY_BUDGET} units spent today, ${ticksLeft} ticks left ` +
  `-> ${budget} calls this tick (${idCap} ids)`
);

// ---------------------------------------------------------------- writers
/** Snapshot + schedule write, shared by the RSS and API passes. */
async function writeRows(rows: DueSnapshotRow[], upsertSnapshot: boolean): Promise<number> {
  if (rows.length === 0) return 0;
  // Deterministic lock order across concurrent writers (launch-track, drain).
  rows.sort((a, b) => (a.video_id < b.video_id ? -1 : a.video_id > b.video_id ? 1 : 0));
  let written = 0;
  for (const group of chunk(rows, 1000)) {
    await withDeadlockRetry(async () => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const values: any[] = [];
        const tuples = group.map((r, i) => {
          values.push(r.video_id, r.snapshot_date, r.view_count, r.like_count, r.comment_count,
                      r.days_since_published, r.daily_views_rate);
          const b = i * 7;
          return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`;
        }).join(',');
        // One row per video per UTC day. An API reading overwrites a same-day RSS reading;
        // an RSS reading never overwrites an API reading (do nothing).
        await client.query(
          `insert into view_snapshots (video_id, snapshot_date, view_count, like_count, comment_count, days_since_published, daily_views_rate)
           values ${tuples}
           on conflict (video_id, snapshot_date) do ${upsertSnapshot
             ? `update set view_count = excluded.view_count, like_count = excluded.like_count,
                          comment_count = excluded.comment_count, daily_views_rate = excluded.daily_views_rate`
             : 'nothing'}`,
          values
        );
        // Set-based: one statement for the whole group, not one UPDATE per video like the
        // nightly did (that was 50 round-trips per batch).
        await client.query(
          `update view_tracking_priority p
              set last_tracked = now()::date, next_track_at = x.next_track_at,
                  priority_tier = x.tier, updated_at = now()
             from (select unnest($1::text[]) as video_id,
                          unnest($2::timestamptz[]) as next_track_at,
                          unnest($3::int[]) as tier) x
            where p.video_id = x.video_id`,
          [group.map((r) => r.video_id), group.map((r) => r.next_track_at.toISOString()), group.map((r) => r.tier)]
        );
        await client.query('commit');
        written += group.length;
      } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
    });
  }
  return written;
}

// ---------------------------------------------------------------- pass 0: the due slice
const dueTotal = (await pool.query<{ n: number }>(
  `select count(*)::int as n from view_tracking_priority where next_track_at <= now()`
)).rows[0].n;
const dueRes = await pool.query<DueRow>(DUE_SELECT_SQL, [dueFetchCap(idCap)]);
console.log(`due: ${dueTotal} videos overdue, pulled ${dueRes.rows.length} oldest-due for this tick`);

// ---------------------------------------------------------------- pass 1: RSS roll-in
const rssRes = await pool.query<RssReading>(RSS_FOR_DUE_SQL, [dueRes.rows.map((r) => r.video_id)]);
const rssMap = new Map(rssRes.rows.map((r) => [r.video_id, r]));
const { rssRows, apiRows } = partitionDue(dueRes.rows, rssMap, idCap);
const rssCovered = DRY_RUN ? rssRows.length : await writeRows(rssRollDueRows(rssRows, now), false);
console.log(`rss: ${rssCovered} of them covered by the feed (0 units); ${apiRows.length} go to the API`);

// ---------------------------------------------------------------- pass 2: due API read
let apiCalls = 0, mainBucketCalls = 0, written = 0;

async function processBatch(batch: DueRow[]): Promise<boolean> {
  const ids = batch.map((r) => r.video_id);
  // videos:batchGetStats has its own 10K/day bucket, leaving the main pool for ingest,
  // discovery and scoring; videos.list (main bucket) is the fallback if it ever misbehaves.
  let res = await fetch(
    `https://www.googleapis.com/youtube/v3/videos:batchGetStats?part=statistics&id=${ids.join(',')}&key=${API_KEY}`
  );
  if (!res.ok && res.status !== 403) {
    res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids.join(',')}&key=${API_KEY}`);
    mainBucketCalls++;
  }
  apiCalls++;
  if (!res.ok) { console.error(`YouTube API error ${res.status}; stopping this tick.`); return false; }
  const data: any = await res.json();

  const meta = new Map<string, DueRow>(batch.map((r) => [r.video_id, r]));
  const prevRes = await pool.query(
    `select distinct on (video_id) video_id, view_count, snapshot_date::text
       from view_snapshots where video_id = any($1) and snapshot_date < current_date
      order by video_id, snapshot_date desc`,
    [ids]
  );
  const prev = new Map<string, { view_count: number; snapshot_date: string }>(
    prevRes.rows.map((r) => [r.video_id, { view_count: r.view_count, snapshot_date: r.snapshot_date }])
  );

  written += await writeRows(buildDueRows(data.items || [], meta, prev, now), true);
  return true;
}

for (const batch of chunk(apiRows, IDS_PER_CALL)) {
  if (DRY_RUN) { apiCalls++; continue; }
  if (outOfTime()) { console.log(`soft deadline reached after ${apiCalls} calls; the rest stays due.`); break; }
  if (!(await processBatch(batch))) break;
}

// ---------------------------------------------------------------- quota log
if (!DRY_RUN && apiCalls > 0) {
  // Logged exactly as the nightly did: one youtube_quota_calls row per unit, the main-bucket
  // share added to youtube_quota_usage, and both buckets split into quota_ledger.
  await pool.query(
    `insert into youtube_quota_calls (date, method, cost, description)
     select current_date, 'videos.list', 1, 'track-due tick' from generate_series(1, $1)`,
    [apiCalls]
  ).catch((e) => console.warn('quota_calls log skipped:', e.message));
  if (mainBucketCalls > 0) {
    await pool.query(
      `insert into youtube_quota_usage (date, quota_used) values (current_date, $1)
       on conflict (date) do update set quota_used = youtube_quota_usage.quota_used + $1`,
      [mainBucketCalls]
    ).catch((e) => console.warn('quota_usage log skipped:', e.message));
  }
  await pool.query(`insert into quota_ledger (category, units) values ('snapshots-batch', $1)`,
    [apiCalls - mainBucketCalls]).catch(() => {});
  if (mainBucketCalls > 0) {
    await pool.query(`insert into quota_ledger (category, units) values ('snapshots', $1)`, [mainBucketCalls]).catch(() => {});
  }
}

console.log(
  `tick done in ${(elapsed() / 1000).toFixed(1)}s: due ${dueTotal}, rss-covered ${rssCovered}, ` +
  `api ${written} snapshots in ${apiCalls} calls (${apiCalls - mainBucketCalls} batch-bucket, ${mainBucketCalls} main-bucket).`
);
await pool.end();
