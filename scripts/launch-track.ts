// Launch-window tracker. Runs every 5 min via LaunchAgent com.mfm.video-scripter-launch-track.
//  - enrolls videos published in the last 30 days into track_schedule (launch window = first 24h)
//  - samples on a log-spaced ladder (see lib/nightly/launch-core.ts): standard 5/15/30 min over
//    0-1h/1-6h/6-24h; dense-tier channels 5/15/30 min over 0-2h/2-24h/24-72h
//  - samples due videos via videos:batchGetStats (separate 10K-unit bucket) -> view_samples,
//    and rolls the latest sample of the day into view_snapshots (daily truth for scoring/admin)
//  - re-enters a video into the launch window when scripts/thumbnail-watch.ts records a new
//    thumbnail version, or when the channel RSS feed (zero quota, hourly) shows a new title
//  - never updates the videos table except title on a confirmed title change
// Direct Postgres only (2026-08-31 egress rule). Usage: npx tsx scripts/launch-track.ts [maxCalls]
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import { chunk, clampCount } from '../lib/nightly/tracking-core';
import { longformSql } from '../lib/scoring/longform';
import {
  nextCheck, reenter, launchUntilFor, titleCheckDue, parseRssTitles, daysSincePublished,
  changeAtFromLaunchUntil, type Tier,
} from '../lib/nightly/launch-core';

// Per-run batch-call cap. 288 runs/day against a 10,000-unit videos:batchGetStats bucket =
// 34.7 units/run of average headroom; 25 keeps a saturated run at 7,200 units/day (72% of the
// bucket) while leaving ~5x headroom over the ~5 calls/run the schedule actually needs.
const maxCalls = parseInt(process.argv[2] || '25', 10); // per run; 288 runs/day
const API_KEY = process.env.YOUTUBE_API_KEY!;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
pool.on('connect', (c: pg.PoolClient) => { c.query('set statement_timeout = 120000').catch(() => {}); });
const now = new Date();
const today = now.toISOString().slice(0, 10);
const log = (m: string) => console.log(`${now.toISOString()} ${m}`);

// --- 1. Enroll: any non-short video published in the last 30 days not yet scheduled ---
const enrolled = await pool.query(
  `insert into track_schedule (video_id, channel_id, published_at, phase, next_check, launch_until, entered_reason)
   select v.id, v.channel_id, v.published_at,
          case when v.published_at > now() - interval '24 hours' then 'launch' else 'fixed' end,
          now(),
          case when v.published_at > now() - interval '24 hours' then v.published_at + interval '24 hours' end,
          case when v.published_at > now() - interval '24 hours' then 'publish' else 'backfill' end
   from videos v
   where v.published_at > now() - interval '30 days'
     and ${longformSql('v')}
     and not exists (select 1 from track_schedule t where t.video_id = v.id)
   on conflict (video_id) do nothing`
);
log(`enrolled ${enrolled.rowCount} new videos`);

// --- 2. Re-entry on thumbnail change (detector = thumbnail-watch.ts writing thumbnail_versions) ---
const reentered = await pool.query(
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

// --- 3. Title checks via channel RSS (zero quota): hourly for launch-window and user-tracked videos, daily for the rest under 30 days ---
const titleDue = await pool.query(
  `select s.video_id, s.channel_id, v.title
     from track_schedule s join videos v on v.id = s.video_id
    left join channel_tracking ct on ct.channel_id = s.channel_id
    where s.channel_id is not null
      and v.published_at > now() - interval '30 days'
      and ${longformSql('v')}
      -- launch window and user-tracked channels hourly; the rest of the recent corpus daily.
      -- RSS lists a channel's last 15 uploads, so one free fetch covers them all.
      and (s.last_title_check is null
           or s.last_title_check < now() - (case when s.phase = 'launch' or ct.lane = 'user' then interval '60 minutes' else interval '24 hours' end))
    order by (s.phase = 'launch' or ct.lane = 'user') desc, s.last_title_check nulls first
    limit 400`
);
type TitleRow = { video_id: string; channel_id: string; title: string };
const byChannel = new Map<string, { video_id: string; title: string }[]>();
for (const r of titleDue.rows as TitleRow[]) {
  if (!byChannel.has(r.channel_id)) byChannel.set(r.channel_id, []);
  byChannel.get(r.channel_id)!.push({ video_id: r.video_id, title: r.title });
}
let titleChanges = 0;
for (const group of chunk([...byChannel.entries()], 10)) {
  await Promise.all(
    group.map(async ([channelId, vids]) => {
      try {
        const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return;
        const titles = parseRssTitles(await res.text());
        for (const v of vids) {
          const t = titles.get(v.video_id);
          if (t == null) continue;
          if (t !== v.title && v.title) {
            const { rows } = (await pool.query(
              `select coalesce(max(version), 0)::int as v from title_versions where video_id = $1`, [v.video_id]
            )) as { rows: { v: number }[] };
            const next = rows[0].v === 0 ? 2 : rows[0].v + 1;
            if (rows[0].v === 0) {
              await pool.query(
                `insert into title_versions (video_id, version, title, first_seen) values ($1, 1, $2, $3) on conflict do nothing`,
                [v.video_id, v.title, now]
              );
            }
            await pool.query(
              `insert into title_versions (video_id, version, title) values ($1, $2, $3) on conflict do nothing`,
              [v.video_id, next, t]
            );
            await pool.query(`update videos set title = $1, updated_at = now() where id = $2`, [t, v.video_id]);
            const r = reenter(now);
            await pool.query(
              `update track_schedule set phase = $1, launch_until = $2, next_check = $3, entered_reason = 'title_change',
                      last_title_check = now(), updated_at = now() where video_id = $4`,
              [r.phase, r.launch_until, r.next_check, v.video_id]
            );
            titleChanges++;
            log(`TITLE CHANGE ${v.video_id}: "${v.title}" -> "${t}"`);
          } else {
            await pool.query(`update track_schedule set last_title_check = now() where video_id = $1`, [v.video_id]);
          }
        }
      } catch { /* transient */ }
    })
  );
}
if (titleDue.rowCount) log(`title checks: ${titleDue.rowCount} videos over ${byChannel.size} feeds, ${titleChanges} changes`);

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
const due = await pool.query(
  `select video_id, channel_id, published_at, last_views,
          case when entered_reason in ('thumbnail_change', 'title_change') then launch_until end as change_until
     from track_schedule where next_check <= now()
    order by phase = 'launch' desc, next_check asc
    limit $1`,
  [maxCalls * 50]
);
log(`due: ${due.rowCount} videos (cap ${maxCalls * 50})`);

type DueRow = {
  video_id: string; channel_id: string | null; published_at: string;
  change_until: string | null; last_views: number | null;
};
let calls = 0, mainCalls = 0, samples = 0;
const tierSamples: Record<Tier, number> = { standard: 0, dense: 0 };
for (const batch of chunk(due.rows as DueRow[], 50)) {
  const ids = batch.map((r) => r.video_id);
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3 && !res; attempt++) {
    try {
      res = await fetch(
        `https://www.googleapis.com/youtube/v3/videos:batchGetStats?part=statistics&id=${ids.join(',')}&key=${API_KEY}`,
        { signal: AbortSignal.timeout(15000) }
      );
    } catch (e) {
      console.error(`fetch attempt ${attempt + 1} failed: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  if (!res) { console.error('YouTube API unreachable; stopping this run.'); break; }
  if (!res.ok && res.status !== 403) {
    try {
      res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids.join(',')}&key=${API_KEY}`,
        { signal: AbortSignal.timeout(15000) });
      mainCalls++;
    } catch { console.error('fallback fetch failed; stopping this run.'); break; }
  }
  calls++;
  if (!res.ok) { console.error(`YouTube API error ${res.status}; stopping.`); break; }
  const data: any = await res.json();
  const items: any[] = data.items || [];
  const meta = new Map<string, DueRow>(batch.map((r) => [r.video_id, r]));

  // Deterministic write order (by video_id) + retry on deadlock (40P01): the nightly tracker and the drain
  // touch the same snapshot rows, and two transactions upserting overlapping ids in different orders deadlock.
  items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (let attempt = 0; attempt < 3; attempt++) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const it of items) {
      const m = meta.get(it.id);
      if (!m) continue;
      const st = it.statistics || {};
      const views = clampCount(parseInt(st.viewCount || '0', 10));
      const likes = clampCount(parseInt(st.likeCount || '0', 10));
      const comments = clampCount(parseInt(st.commentCount || '0', 10));
      const published = new Date(m.published_at);
      await client.query(
        `insert into view_samples (video_id, sampled_at, view_count, like_count, comment_count)
         values ($1, $2, $3, $4, $5) on conflict do nothing`,
        [it.id, now, views, likes, comments]
      );
      await client.query(
        `insert into view_snapshots (video_id, snapshot_date, view_count, like_count, comment_count, days_since_published)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (video_id, snapshot_date) do update set
           view_count = excluded.view_count, like_count = excluded.like_count, comment_count = excluded.comment_count`,
        [it.id, today, views, likes, comments, daysSincePublished(published, now)]
      );
      const tier = tierOf(it.id, m.channel_id);
      const nx = nextCheck(
        {
          published_at: published,
          change_at: changeAtFromLaunchUntil(m.change_until ? new Date(m.change_until) : null),
          tier,
          last_views: views,
        },
        now
      );
      tierSamples[tier]++;
      await client.query(
        `update track_schedule set phase = $1, next_check = $2, checks = checks + 1, last_sample_at = $3,
                last_views = $4, updated_at = now() where video_id = $5`,
        [nx.phase, nx.next_check, now, views, it.id]
      );
      samples++;
    }
    // ids the API didn't return (deleted/private): push out a day so they don't spin
    const got = new Set(items.map((i) => i.id));
    const missing = ids.filter((id) => !got.has(id));
    if (missing.length) {
      await client.query(
        `update track_schedule set next_check = now() + interval '1 day', updated_at = now() where video_id = any($1)`,
        [missing]
      );
    }
    await client.query('commit');
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

// Ledger holds the exact batch-bucket units spent; the per-tier split is logged for attribution
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
