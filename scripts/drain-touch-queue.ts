// Continuous touch-queue drainer (runs every 5 min via LaunchAgent).
// Resolves queued refs, skips anything already tracked, imports new videos
// immediately, enrolls new channels and imports their latest uploads.
// Direct Postgres only (egress-clean); YouTube via official API.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import { clampCount, chunk } from '../lib/nightly/tracking-core';
import { planEnrollment, KnownChannels } from '../lib/nightly/enrollment-core';

const API_KEY = process.env.YOUTUBE_API_KEY!;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
let quota = 0;

function isShortDuration(dur: string | null | undefined): boolean {
  if (!dur) return false;
  const m = dur.match(/^PT(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return false;
  return (parseInt(m[1] || '0', 10)) * 60 + parseInt(m[2] || '0', 10) <= 62;
}

async function insertVideo(v: any, tier = 1): Promise<boolean> {
  if (isShortDuration(v.contentDetails?.duration)) return false;
  const sn = v.snippet || {}; const st = v.statistics || {};
  await pool.query(
    `insert into videos (id, title, description, channel_id, channel_name, published_at,
                         view_count, like_count, comment_count, duration, thumbnail_url,
                         data_source, is_competitor, import_date, updated_at, user_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'competitor',true,now(),now(),'00000000-0000-0000-0000-000000000000')
     on conflict (id) do nothing`,
    [v.id, sn.title || '', (sn.description || '').slice(0, 50000), sn.channelId, sn.channelTitle || '',
     sn.publishedAt, clampCount(parseInt(st.viewCount || '0', 10)), clampCount(parseInt(st.likeCount || '0', 10)),
     clampCount(parseInt(st.commentCount || '0', 10)), v.contentDetails?.duration || null,
     sn.thumbnails?.maxres?.url || sn.thumbnails?.high?.url || null]
  );
  await pool.query(
    `insert into view_snapshots (video_id, snapshot_date, view_count, like_count, comment_count, days_since_published)
     values ($1, current_date, $2, $3, $4, (current_date - $5::date)) on conflict do nothing`,
    [v.id, clampCount(parseInt(st.viewCount || '0', 10)), clampCount(parseInt(st.likeCount || '0', 10)), clampCount(parseInt(st.commentCount || '0', 10)), sn.publishedAt]
  );
  await pool.query(
    `insert into view_tracking_priority (video_id, priority_tier, next_track_date)
     values ($1, $2, current_date + 1) on conflict (video_id) do nothing`,
    [v.id, tier]
  );
  return true;
}

async function fetchVideos(ids: string[]): Promise<any[]> {
  const out: any[] = [];
  for (const group of chunk(ids, 50)) {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${group.join(',')}&key=${API_KEY}`
    );
    quota++;
    if (res.ok) out.push(...(((await res.json()) as any).items || []));
  }
  return out;
}

// Budget guards: discovery has a daily cap so browsing can never starve the
// snapshot/ingest machinery; a global floor protects the whole bucket.
const DISCOVERY_DAILY_CAP = 2000;
const GLOBAL_FLOOR = 9000; // stop all discovery once total quota passes this
const [{ spent }] = (await pool.query(
  `select coalesce(sum(units),0)::int as spent from quota_ledger where date=current_date and category='discovery'`
)).rows;
const [{ total }] = (await pool.query(
  `select coalesce(quota_used,0)::int as total from youtube_quota_usage where date=current_date`
)).rows;
if (spent >= DISCOVERY_DAILY_CAP) { console.log(`discovery cap reached (${spent}/${DISCOVERY_DAILY_CAP}); queue holds until tomorrow`); await pool.end(); process.exit(0); }
if (total >= GLOBAL_FLOOR) { console.log(`global quota floor reached (${total}); discovery paused`); await pool.end(); process.exit(0); }

const { rows } = await pool.query(
  `select id, kind, ref, mode from touch_queue where processed_at is null order by id limit 1000`
);
if (!rows.length) { console.log('queue empty'); await pool.end(); process.exit(0); }

// --- 1. Resolve refs to channel ids / video ids, skipping already-known ---
const videoRows = rows.filter((r) => r.kind === 'video');
const known = new Set<string>();
for (const group of chunk(videoRows, 500)) {
  const res = await pool.query(`select id from videos where id = any($1)`, [group.map((r) => r.ref)]);
  res.rows.forEach((r) => known.add(r.id));
}
const newVideoRows = videoRows.filter((r) => !known.has(r.ref));

const channelIds = new Map<number, string | null>();
for (const r of rows.filter((x) => x.kind === 'channel')) channelIds.set(r.id, r.ref);
for (const h of rows.filter((x) => x.kind === 'handle')) {
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(h.ref)}&key=${API_KEY}`
  );
  quota++;
  channelIds.set(h.id, res.ok ? ((await res.json()) as any).items?.[0]?.id || null : null);
}

// --- 2. Video rows: clicked videos import + enroll their channel.
// Feed/passive videos are DISCOVERY SIGNALS ONLY: resolve to channel
// candidates (dedupe against tracked channels); do not hoard the videos.
let imported = 0;
let candidatesSeen = 0;
const candidateChannels = new Map<string, number>(); // channelId -> times seen this drain
const vids = await fetchVideos(newVideoRows.map((r) => r.ref));
for (const v of vids) {
  const row = newVideoRows.find((r) => r.ref === v.id);
  if (!row) continue;
  if (row.mode === 'click' || row.mode === 'websub') {
    if (await insertVideo(v, row.mode === 'websub' ? 0 : 1)) imported++;
    if (row.mode === 'click' && v.snippet?.channelId) channelIds.set(row.id, v.snippet.channelId);
  } else if (v.snippet?.channelId) {
    candidateChannels.set(v.snippet.channelId, (candidateChannels.get(v.snippet.channelId) || 0) + 1);
  }
}

// Candidate upsert: only channels we don't already track
if (candidateChannels.size) {
  const candIds = [...candidateChannels.keys()];
  const tracked = await pool.query(
    `select channel_id as id from discovered_channels where channel_id = any($1)
     union select youtube_channel_id from competitor_youtube_channels where youtube_channel_id = any($1)`,
    [candIds]
  );
  const trackedSet = new Set(tracked.rows.map((r) => r.id));
  const fresh = candIds.filter((c) => !trackedSet.has(c));
  for (const group of chunk(fresh, 50)) {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${group.join(',')}&key=${API_KEY}`
    );
    quota++;
    for (const c of (res.ok ? (((await res.json()) as any).items || []) : [])) {
      await pool.query(
        `insert into channel_candidates (channel_id, channel_title, subscriber_count, video_count, seen_count)
         values ($1,$2,$3,$4,$5)
         on conflict (channel_id) do update set
           last_seen = now(), seen_count = channel_candidates.seen_count + $5,
           channel_title = excluded.channel_title, subscriber_count = excluded.subscriber_count`,
        [c.id, c.snippet?.title || c.id, clampCount(parseInt(c.statistics?.subscriberCount || '0', 10)),
         clampCount(parseInt(c.statistics?.videoCount || '0', 10)), candidateChannels.get(c.id) || 1]
      ).catch(() => {});
      candidatesSeen++;
    }
  }
  // AUTO-ENROLL: feed-discovered untracked channels enter the same enrollment
  // pipeline as clicked ones (metadata + latest 50 uploads + RSS from tonight).
  for (const [i, c] of fresh.entries()) channelIds.set(-1000 - i, c);
}

// --- 3. Enroll new channels + import their latest uploads immediately ---
// Four-registry dedup via enrollment-core (fixes the double-tracking bug).
const uniqueChannels = [...new Set([...channelIds.values()].filter(Boolean))] as string[];
const knownChannels: KnownChannels = {
  competitor: new Set(), discovered: new Set(), legacy: new Set(), withVideos: new Set(),
};
if (uniqueChannels.length) {
  const [comp, disc, leg, wv] = await Promise.all([
    pool.query(`select youtube_channel_id id from competitor_youtube_channels where youtube_channel_id = any($1)`, [uniqueChannels]),
    pool.query(`select channel_id id from discovered_channels where channel_id = any($1)`, [uniqueChannels]),
    pool.query(`select channel_id id from channels where channel_id = any($1)`, [uniqueChannels]),
    pool.query(`select distinct channel_id id from videos where channel_id = any($1)`, [uniqueChannels]),
  ]);
  comp.rows.forEach((r) => knownChannels.competitor.add(r.id));
  disc.rows.forEach((r) => knownChannels.discovered.add(r.id));
  leg.rows.forEach((r) => knownChannels.legacy.add(r.id));
  wv.rows.forEach((r) => knownChannels.withVideos.add(r.id));
}
const plan = planEnrollment(
  [...channelIds].map(([queueId, channelId]) => ({ queueId, channelId })),
  knownChannels
);
const existing = new Set<string>(
  uniqueChannels.filter((c) => !plan.toEnroll.includes(c))
);
const newChannels = plan.toEnroll;

let channelsEnrolled = 0;
let channelVideos = 0;
for (const group of chunk(newChannels, 50)) {
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${group.join(',')}&key=${API_KEY}`
  );
  quota++;
  const items = res.ok ? (((await res.json()) as any).items || []) : [];
  for (const c of items) {
    const ins = await pool.query(
      `insert into discovered_channels (channel_id, channel_title, channel_handle, subscriber_count, video_count, view_count, discovery_method)
       values ($1,$2,$3,$4,$5,$6,'touch_queue') on conflict (channel_id) do nothing`,
      [c.id, c.snippet?.title || c.id, c.snippet?.customUrl || null,
       clampCount(parseInt(c.statistics?.subscriberCount || '0', 10)),
       clampCount(parseInt(c.statistics?.videoCount || '0', 10)),
       clampCount(parseInt(c.statistics?.viewCount || '0', 10))]
    ).catch(() => ({ rowCount: 0 }));
    if (!ins.rowCount) continue;
    channelsEnrolled++;
    // pull their latest uploads page right away so the channel is instantly useful
    const pl = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=UU${c.id.slice(2)}&maxResults=50&key=${API_KEY}`
    );
    quota++;
    if (pl.ok) {
      const ids = (((await pl.json()) as any).items || []).map((i: any) => i.contentDetails.videoId);
      const kn = await pool.query(`select id from videos where id = any($1)`, [ids]);
      const knSet = new Set(kn.rows.map((r) => r.id));
      for (const v of await fetchVideos(ids.filter((id: string) => !knSet.has(id)))) {
        if (await insertVideo(v, 1)) channelVideos++;
      }
    }
  }
}

// candidates ledger reflects auto-enrollment
await pool.query(
  `update channel_candidates set status='enrolled'
   where status='candidate' and channel_id in (select channel_id from discovered_channels)`
).catch(() => {});

// --- 3b. Live-stream maintenance: refresh duration on recent P0D videos so
// ended streams (now VODs with a real thumbnail) rejoin the thumbnail watch.
const { rows: liveRows } = await pool.query(
  `select id from videos where duration = 'P0D' and published_at > now() - interval '30 days' limit 500`
);
if (liveRows.length) {
  let refreshed = 0;
  for (const group of chunk(liveRows.map((r) => r.id), 50)) {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${group.join(',')}&key=${API_KEY}`
    );
    quota++;
    for (const v of (res.ok ? (((await res.json()) as any).items || []) : [])) {
      const dur = v.contentDetails?.duration || null;
      if (dur && dur !== 'P0D') {
        await pool.query(`update videos set duration=$2, updated_at=now() where id=$1`, [v.id, dur]);
        // wipe feed-frame garbage so the VOD baselines from its real thumbnail
        await pool.query(`delete from thumbnail_versions where video_id=$1`, [v.id]);
        refreshed++;
      }
    }
  }
  if (refreshed) console.log(`Live maintenance: ${refreshed} ended streams got real durations`);
}

// --- 4. Mark everything processed ---
for (const r of rows) {
  const ch = channelIds.get(r.id);
  const result =
    r.kind === 'video'
      ? known.has(r.ref) ? 'already-tracked'
        : (r.mode === 'click' || r.mode === 'websub') ? 'imported' : 'candidate-signal'
      : ch ? (existing.has(ch) ? `already-enrolled:${ch}` : `enrolled:${ch}`) : 'unresolved';
  await pool.query(`update touch_queue set processed_at = now(), result = $2 where id = $1`, [r.id, result]);
}

await pool.query(
  `insert into youtube_quota_usage (date, quota_used) values (current_date, $1)
   on conflict (date) do update set quota_used = youtube_quota_usage.quota_used + $1`, [quota]
).catch(() => {});
await pool.query(`insert into quota_ledger (category, units) values ('discovery', $1)`, [quota]).catch(() => {});
await pool.query(
  `insert into ext_growth_cache
     select import_date::date, count(*) from videos
     where import_date >= current_date group by 1
   on conflict (day) do update set videos_added = excluded.videos_added`
).catch(() => {});
console.log(
  `Drained ${rows.length} rows: ${imported} clicked videos imported, ${candidatesSeen} channel candidates surfaced, ${channelsEnrolled} channels enrolled (+${channelVideos} videos), ${quota} quota units`
);
await pool.end();
