// Launch-window tracker. Runs every 5 min via LaunchAgent com.mfm.video-scripter-launch-track.
//  - enrolls videos published in the last 30 days into track_schedule (launch window = first 24h)
//  - samples on a log-spaced ladder (see lib/nightly/launch-core.ts): standard 5/15/30 min over
//    0-1h/1-6h/6-24h; dense-tier channels 5/15/30 min over 0-2h/2-24h/24-72h
//  - samples due videos via videos:batchGetStats (separate 10K-unit bucket) -> view_samples,
//    and rolls the latest sample of the day into view_snapshots (daily truth for scoring/admin)
//  - re-enters a video into the launch window when scripts/thumbnail-watch.ts records a new
//    thumbnail version, or when any detector writes a new title_versions row (scripts/rss-poll.ts
//    owns the RSS title check since the 2026-09-03 rollout; thumbnail-watch owns the oEmbed one)
//  - never updates the videos table except title on a confirmed title change
// Direct Postgres only (2026-08-31 egress rule). Usage: npx tsx scripts/launch-track.ts [maxCalls]
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import { chunk, clampCount } from '../lib/nightly/tracking-core';
import { longformSql } from '../lib/scoring/longform';
import { startManagedJob } from '../lib/nightly/job-lifecycle';
import {
  nextCheck, launchUntilFor, daysSincePublished,
  changeAtFromLaunchUntil, type Tier,
} from '../lib/nightly/launch-core';
import { decideSamplingSource } from '../lib/nightly/sampling-freshness';
import { readStatsResponse } from '../lib/nightly/stats-response';
import { writeSampleBatch, type SampleWrite } from '../lib/nightly/sample-batch';
import { dueSamplingCandidatesSql, prioritizeApiCandidates } from '../lib/nightly/sampling-candidates';
import { LAST_SAMPLES_SQL } from '../lib/rss/poll-policy';

// Per-run batch-call cap. 288 runs/day against a 10,000-unit videos:batchGetStats bucket =
// 34.7 units/run of average headroom; 25 keeps a saturated run at 7,200 units/day (72% of the
// bucket) while leaving ~5x headroom over the ~5 calls/run the schedule actually needs.
const args = process.argv.slice(2);
const maxCalls = parseInt(args.find((a, i) => /^\d+$/.test(a) && args[i - 1] !== '--max-seconds') || '25', 10); // per run; 288 runs/day
const DRY = args.includes('--dry');
const job = DRY
  ? { acquired: true, signal: new AbortController().signal, finish: () => {} }
  : startManagedJob({ name: 'launch-track', args });
if (!job.acquired) process.exit(0);
const API_KEY = process.env.YOUTUBE_API_KEY!;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
pool.on('connect', (c: pg.PoolClient) => { c.query('set statement_timeout = 120000').catch(() => {}); });
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

// --- 1. Enroll: any non-short video published in the last 30 days not yet scheduled ---
const enrolled = DRY ? { rowCount: 0 } : await pool.query(
  `insert into track_schedule (video_id, channel_id, published_at, phase, next_check, launch_until, entered_reason,
                               last_sample_at, last_views)
   select v.id, v.channel_id, v.published_at,
          case when v.published_at > now() - interval '24 hours' then 'launch' else 'fixed' end,
          case when recent.sampled_at > now() - interval '5 minutes' and recent.sampled_at <= now()
               then recent.sampled_at + interval '5 minutes' else now() end,
          case when v.published_at > now() - interval '24 hours' then v.published_at + interval '24 hours' end,
          case when v.published_at > now() - interval '24 hours' then 'publish' else 'backfill' end,
          case when recent.sampled_at > now() - interval '5 minutes' and recent.sampled_at <= now()
               then recent.sampled_at end,
          case when recent.sampled_at > now() - interval '5 minutes' and recent.sampled_at <= now()
               then recent.view_count end
   from videos v
   left join lateral (
     select s.sampled_at, s.view_count from view_samples s
      where s.video_id = v.id order by s.sampled_at desc limit 1
   ) recent on true
   where v.published_at > now() - interval '30 days'
     and ${longformSql('v')}
     and not exists (select 1 from track_schedule t where t.video_id = v.id)
   on conflict (video_id) do nothing`
);
log(`enrolled ${enrolled.rowCount} new videos`);

// --- 2. Re-entry on thumbnail change (detector = thumbnail-watch.ts writing thumbnail_versions) ---
const reentered = DRY ? { rowCount: 0 } : await pool.query(
  `with latest as (
     select t.video_id, max(t.version) as v from thumbnail_versions t
     join track_schedule s on s.video_id = t.video_id
     where t.version > 1 and t.first_seen > now() - interval '2 days'
     group by t.video_id)
   update track_schedule s
      set phase = 'launch', launch_until = now() + interval '24 hours', next_check = now(),
          entered_reason = 'thumbnail_change', last_version_seen = l.v, updated_at = now()
     from latest l
    where l.video_id = s.video_id and l.v > s.last_version_seen
   returning s.video_id`
);
if (reentered.rowCount) log(`re-entered ${reentered.rowCount} videos after thumbnail change`);

// --- 2b. Re-entry on title change (detector = anything that writes title_versions: the RSS
// poller, the watcher's oEmbed pass, a backfill). The poller re-enters the videos it detects
// itself; this is the catch-all so no title_versions row is ever missed. last_title_version_seen
// makes it fire exactly once per version.
const titleReentered = DRY ? { rowCount: 0 } : await pool.query(
  `with latest as (
     select t.video_id, max(t.version) as v from title_versions t
     join track_schedule s on s.video_id = t.video_id
     where t.version > 1 and t.first_seen > now() - interval '2 days'
       -- backfill rows are syncs, not news (lib/rss/title-change.ts): a title that drifted while
       -- nobody was looking must not re-open the 5-minute ladder and burn stats quota
       and t.backfill = false
     group by t.video_id)
   update track_schedule s
      set phase = 'launch', launch_until = now() + interval '24 hours', next_check = now(),
          entered_reason = 'title_change', last_title_version_seen = l.v, updated_at = now()
     from latest l
    where l.video_id = s.video_id and l.v > s.last_title_version_seen
   returning s.video_id`
);
if (titleReentered.rowCount) log(`re-entered ${titleReentered.rowCount} videos after title change`);

// --- 3. Titles: RETIRED here (2026-09-03 rollout, plan section 1 + "Rollout") ---
// scripts/rss-poll.ts owns titles for every channel now: it polls the same feed every 15
// minutes instead of this script's 60-minute/daily pass, writes title_versions through the
// shared path in lib/rss/title-change.ts, and re-enters the video itself. Step 2b above stays
// as the catch-all re-entry for any title_versions row this script did not write. The 14-90 day
// videos that have fallen out of their channel's 15-entry RSS window are covered by the oEmbed
// check in scripts/thumbnail-watch.ts.

// --- 4. Dense-tier lookup: ONE query per run, not one per video ---
// Dense = any channel with a packaging change in the trailing 60 days, or any individual video
// that has already had one (repeat changers are live A/B tests and the highest-value curves).
const denseRows = await pool.query(
  `with changed as (
     select t.video_id from thumbnail_versions t
      where t.version > 1 and t.first_seen > now() - interval '60 days'
     union
     select ti.video_id from title_versions ti
      where ti.version > 1 and ti.first_seen > now() - interval '60 days')
   select 'v' as kind, c.video_id as id from changed c
   union
   select 'c' as kind, v.channel_id as id from changed c join videos v on v.id = c.video_id
    where v.channel_id is not null`
);
const denseVideos = new Set<string>();
const denseChannels = new Set<string>();
for (const r of denseRows.rows as { kind: string; id: string }[]) {
  (r.kind === 'v' ? denseVideos : denseChannels).add(r.id);
}
log(`dense tier: ${denseChannels.size} channels, ${denseVideos.size} videos`);
const tierOf = (videoId: string, channelId: string | null): Tier =>
  denseVideos.has(videoId) || (channelId && denseChannels.has(channelId)) ? 'dense' : 'standard';

// --- 5. Sample due videos ---
// RSS may remove routine candidates from the API batch, so inspect a bounded multiple of the
// API capacity. This lets later genuinely API-due rows fill the 25 batches without an
// unbounded schedule scan.
const apiCapacity = maxCalls * 50;
const candidateCap = apiCapacity * 4;
const candidateQuery = dueSamplingCandidatesSql({
  denseVideoIds: [...denseVideos], denseChannelIds: [...denseChannels],
  urgentLimit: apiCapacity, oldestLimit: candidateCap,
});
const due = await pool.query(candidateQuery.text, candidateQuery.values);
log(`due candidates: ${due.rowCount} (scan cap ${candidateCap + apiCapacity}, API capacity ${apiCapacity})`);

type DueRow = {
  video_id: string; channel_id: string | null; published_at: string;
  change_until: string | null; last_views: number | null; last_sample_at?: string | null;
  next_check: string; updated_at: string;
};
type RssRow = { video_id: string; at: string; views: number | null };

const candidates = due.rows as DueRow[];
const candidateIds = candidates.map((r) => r.video_id);
const rssRows: RssRow[] = candidateIds.length
  ? (await pool.query(LAST_SAMPLES_SQL, [candidateIds])).rows
  : [];
const rssById = new Map(rssRows.map((r) => [r.video_id, r]));
const now = new Date();

const apiCandidates: Array<{ row: DueRow; reason: string }> = [];
const rssSatisfied: Array<{ row: DueRow; views: number; phase: string; next: Date }> = [];
const reasons = new Map<string, number>();
for (const row of candidates) {
  const published = new Date(row.published_at);
  const tier = tierOf(row.video_id, row.channel_id);
  const schedule = nextCheck({
    published_at: published,
    change_at: changeAtFromLaunchUntil(row.change_until ? new Date(row.change_until) : null),
    tier,
    last_views: row.last_views,
  }, now);
  const intervalMinutes = (schedule.next_check.getTime() - now.getTime()) / 60_000;
  const rss = rssById.get(row.video_id);
  const decision = decideSamplingSource({
    intervalMinutes,
    lastViews: row.last_views,
    lastApiAt: row.last_sample_at ? new Date(row.last_sample_at) : null,
    rssAt: rss ? new Date(rss.at) : null,
    rssViews: rss?.views == null ? null : Number(rss.views),
  }, now);
  reasons.set(decision.reason, (reasons.get(decision.reason) || 0) + 1);
  if (decision.source === 'api') {
    apiCandidates.push({ row, reason: decision.reason });
    continue;
  }
  rssSatisfied.push({
    row,
    views: clampCount(Number(rss!.views)),
    phase: schedule.phase,
    next: schedule.next_check,
  });
}
const apiDue = prioritizeApiCandidates(apiCandidates, apiCapacity);
log(`sampling plan: ${apiDue.length} API, ${rssSatisfied.length} RSS; ${Array.from(reasons).map(([k, v]) => `${k}=${v}`).join(', ')}`);

if (DRY) {
  log('dry run: no enrollment, re-entry, API calls, schedule updates, samples, snapshots, or quota writes');
  await pool.end();
  job.finish();
  process.exit(0);
}

// Advancing these rows is the only scheduler write performed for an RSS-satisfied deadline.
// last_sample_at remains the last API observation so the six-hour crosscheck cannot drift.
let rssAdvanced = 0;
for (const group of chunk(rssSatisfied, 500)) {
  const values: any[] = [];
  const tuples = group.map((r, i) => {
    const n = i * 6;
    values.push(r.row.video_id, r.phase, r.next, r.views, r.row.next_check, r.row.updated_at);
    return `($${n + 1}::text,$${n + 2}::text,$${n + 3}::timestamptz,$${n + 4}::integer,$${n + 5}::timestamptz,$${n + 6}::timestamptz)`;
  });
  const advanced = await pool.query(
    `update track_schedule s set phase = x.phase, next_check = x.next_check,
            checks = checks + 1, last_views = x.views, updated_at = now()
       from (values ${tuples.join(',')}) as x(video_id, phase, next_check, views, prior_next_check, prior_updated_at)
      where s.video_id = x.video_id and s.next_check = x.prior_next_check and s.updated_at = x.prior_updated_at`,
    values
  );
  rssAdvanced += advanced.rowCount ?? 0;
}
if (rssSatisfied.length) {
  log(`RSS schedule updates: ${rssAdvanced} advanced, ${rssSatisfied.length - rssAdvanced} raced`);
}

let calls = 0, mainCalls = 0, samples = 0;
const tierSamples: Record<Tier, number> = { standard: 0, dense: 0 };
for (const batch of chunk(apiDue, 50)) {
  if (job.signal.aborted || calls >= maxCalls) break;
  const ids = batch.map((r) => r.video_id);
  let result = await readStatsResponse({
    maxAttempts: Math.min(3, maxCalls - calls), signal: job.signal,
    onAttempt: () => { calls++; },
    fetchResponse: () => fetch(
      `https://www.googleapis.com/youtube/v3/videos:batchGetStats?part=statistics&id=${ids.join(',')}&key=${API_KEY}`,
      { signal: AbortSignal.timeout(15000) }),
  });
  if (!result) { console.error('YouTube response unavailable after bounded retries; leaving remaining videos due.'); break; }
  if (!result.response.ok && result.response.status !== 403) {
    result = await readStatsResponse({
      maxAttempts: Math.min(1, maxCalls - calls), signal: job.signal,
      onAttempt: () => { calls++; mainCalls++; },
      fetchResponse: () => fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids.join(',')}&key=${API_KEY}`,
        { signal: AbortSignal.timeout(15000) }),
    });
    if (!result) { console.error('Fallback unavailable or request budget exhausted; leaving remaining videos due.'); break; }
  }
  if (!result.response.ok) { console.error(`YouTube API error ${result.response.status}; stopping.`); break; }
  const data = result.data;
  const items: any[] = data.items || [];
  const meta = new Map<string, DueRow>(batch.map((r) => [r.video_id, r]));

  // Timestamp the returned observation, not the start of a potentially long worker run.
  const sampledAt = new Date();
  const batchTiers: Record<Tier, number> = { standard: 0, dense: 0 };
  const writes: SampleWrite[] = [];
  for (const it of items) {
    const m = meta.get(it.id);
    if (!m) continue;
    const st = it.statistics || {};
    const views = clampCount(parseInt(st.viewCount || '0', 10));
    const tier = tierOf(it.id, m.channel_id);
    const published = new Date(m.published_at);
    const nx = nextCheck({ published_at: published,
      change_at: changeAtFromLaunchUntil(m.change_until ? new Date(m.change_until) : null), tier, last_views: views }, sampledAt);
    writes.push({videoId: it.id, sampledAt, views,
      likes: clampCount(parseInt(st.likeCount || '0', 10)), comments: clampCount(parseInt(st.commentCount || '0', 10)),
      daysSincePublished: daysSincePublished(published, sampledAt), phase: nx.phase, nextCheck: nx.next_check,
      priorNextCheck: m.next_check, priorUpdatedAt: m.updated_at});
    batchTiers[tier]++;
  }
  // Retry the entire atomic batch; counters advance only after a successful commit.
  for (let attempt = 0; attempt < 3; attempt++) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("set local statement_timeout = '30s'");
    const advanced = await writeSampleBatch(client, writes);
    // ids the API didn't return (deleted/private): push out a day so they don't spin
    const got = new Set(items.map((i) => i.id));
    const missing = batch.filter((r) => !got.has(r.video_id));
    if (missing.length) {
      const values: any[] = [];
      const tuples = missing.map((r, i) => {
        const n = i * 3;
        values.push(r.video_id, r.next_check, r.updated_at);
        return `($${n + 1}::text,$${n + 2}::timestamptz,$${n + 3}::timestamptz)`;
      });
      await client.query(
        `update track_schedule s set next_check = now() + interval '1 day', updated_at = now()
           from (values ${tuples.join(',')}) as x(video_id, prior_next_check, prior_updated_at)
          where s.video_id = x.video_id and s.next_check = x.prior_next_check and s.updated_at = x.prior_updated_at`,
        values
      );
    }
    await client.query('commit');
    samples += writes.length;
    tierSamples.standard += batchTiers.standard;
    tierSamples.dense += batchTiers.dense;
    log(`API batch: ${writes.length} samples, ${advanced} schedules advanced, ${writes.length - advanced} raced`);
    break;
  } catch (e: any) {
    await client.query('rollback').catch(() => {});
    if (e?.code === '40P01' && attempt < 2) {
      console.error(`deadlock on batch, retry ${attempt + 1}`);
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      continue;
    }
    throw e;
  } finally {
    client.release();
  }
  }
}

// Ledger conservatively counts HTTP attempts, including failed/truncated responses; the per-tier split is logged for attribution
// (units are per 50-id call, so the tier share is samples/50).
const batchUnits = calls - mainCalls;
await pool.query(`insert into quota_ledger (category, units) values ('launch-track-batch', $1)`, [batchUnits]).catch(() => {});
log(
  `units: ${batchUnits} batch (standard ~${(tierSamples.standard / 50).toFixed(2)} from ` +
  `${tierSamples.standard} samples, dense ~${(tierSamples.dense / 50).toFixed(2)} from ${tierSamples.dense} samples)`
);
if (mainCalls) {
  await pool.query(`insert into quota_ledger (category, units) values ('launch-track', $1)`, [mainCalls]).catch(() => {});
  await pool.query(
    `insert into youtube_quota_usage (date, quota_used) values (current_date, $1)
     on conflict (date) do update set quota_used = youtube_quota_usage.quota_used + $1`, [mainCalls]
  ).catch(() => {});
}
log(`done: ${samples} samples, ${calls} calls (${calls - mainCalls} batch-bucket, ${mainCalls} main)`);
await pool.end();
job.finish();
