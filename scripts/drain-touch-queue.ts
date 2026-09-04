// Continuous touch-queue drainer (runs every 5 min via LaunchAgent).
// Resolves queued refs, skips anything already tracked, imports new videos
// immediately, enrolls new channels and imports their latest uploads.
// Direct Postgres only (egress-clean); YouTube via official API.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import { clampCount, chunk } from '../lib/nightly/tracking-core';
import { planEnrollment, KnownChannels } from '../lib/nightly/enrollment-core';
import { decideVideoRow, corpusTrackedChannels, type TouchResult } from '../lib/nightly/touch-decision';
import { withDeadlockRetry } from '../lib/nightly/pg-retry';
import { classifyForInsert, skipForInsert, type InsertClassification } from '../lib/ingest/classify';
import { startManagedJob } from '../lib/nightly/job-lifecycle';
import { ingestWrites } from '../lib/ingest/first-sample';
import {
  PRIORITY_LANE, PRIORITY_MODES, selectPriorityRows, orderByPublishedDesc,
  isPriorityImport, quotaUnits, channelFromSourceUrl,
} from '../lib/nightly/priority-lane';

const job = startManagedJob({ name: 'touch-drain' });
if (!job.acquired) process.exit(0);

const API_KEY = process.env.YOUTUBE_API_KEY!;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
let quota = 0;

async function insertVideo(v: any, tier = 1): Promise<boolean> {
  // One shared Shorts/live rule (lib/ingest/classify.ts). A 63-180s clip is settled against
  // YouTube; if it cannot be reached the row is stored unverified and longformSql hides it.
  const cls = await classifyForInsert(v);
  if (skipForInsert(cls.kind)) return false;
  const sn = v.snippet || {}; const st = v.statistics || {};
  // Deadlock-retried: the videos insert fires sync_institutional triggers that
  // can deadlock against concurrent launch-track/nightly-tracking writers
  // (observed 40P01 overnight 2026-09-02).
  await withDeadlockRetry(() => insertVideoOnce(v, tier, sn, st, cls));
  return true;
}

async function insertVideoOnce(v: any, tier: number, sn: any, st: any, cls: InsertClassification): Promise<void> {
  await pool.query(
    `insert into videos (id, title, description, channel_id, channel_name, published_at,
                         view_count, like_count, comment_count, duration, thumbnail_url,
                         data_source, is_competitor, import_date, updated_at, user_id,
                         is_short, shorts_checked_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'competitor',true,now(),now(),'00000000-0000-0000-0000-000000000000',
             $12, case when $13::boolean then now() else null end)
     on conflict (id) do update set
       is_short = case when excluded.shorts_checked_at is not null then excluded.is_short else videos.is_short end,
       shorts_checked_at = coalesce(excluded.shorts_checked_at, videos.shorts_checked_at)`,
    [v.id, sn.title || '', (sn.description || '').slice(0, 50000), sn.channelId, sn.channelTitle || '',
     sn.publishedAt, clampCount(parseInt(st.viewCount || '0', 10)), clampCount(parseInt(st.likeCount || '0', 10)),
     clampCount(parseInt(st.commentCount || '0', 10)), v.contentDetails?.duration || null,
     sn.thumbnails?.maxres?.url || sn.thumbnails?.high?.url || null,
     cls.is_short, cls.shorts_checked_at === 'now']
  );
  // A sample, a daily snapshot and a tracking row, in that order (lib/ingest/first-sample.ts).
  // The videos.list response in hand IS an observation at a known instant, so it is written as
  // a view_samples row now rather than leaving the video unmeasured until the next tracker tick
  // — which for an RSS-discovered video was up to a day after we already knew its view count.
  for (const w of ingestWrites(v, tier, new Date())) await pool.query(w.sql, w.params);
}

async function fetchVideos(ids: string[]): Promise<any[]> {
  const out: any[] = [];
  for (const group of chunk(ids, 50)) {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails,liveStreamingDetails&id=${group.join(',')}&key=${API_KEY}`
    );
    quota++;
    if (res.ok) out.push(...(((await res.json()) as any).items || []));
  }
  return out;
}

// The four registries a channel can be "ours" in (enrollment-core isTracked reads all four).
async function loadKnownChannels(ids: string[]): Promise<KnownChannels> {
  const known: KnownChannels = { competitor: new Set(), discovered: new Set(), legacy: new Set(), withVideos: new Set() };
  if (!ids.length) return known;
  const [comp, disc, leg, wv] = await Promise.all([
    pool.query(`select youtube_channel_id id from competitor_youtube_channels where youtube_channel_id = any($1)`, [ids]),
    pool.query(`select channel_id id from discovered_channels where channel_id = any($1)`, [ids]),
    pool.query(`select channel_id id from channels where channel_id = any($1)`, [ids]),
    // Corpus membership only counts once it is older than the grace window: a channel whose
    // first upload we imported minutes ago still needs enrolling (corpusTrackedChannels).
    pool.query(`select channel_id, min(import_date) first_import from videos where channel_id = any($1) group by channel_id`, [ids]),
  ]);
  comp.rows.forEach((r) => known.competitor.add(r.id));
  disc.rows.forEach((r) => known.discovered.add(r.id));
  leg.rows.forEach((r) => known.legacy.add(r.id));
  known.withVideos = corpusTrackedChannels(wv.rows);
  return known;
}

// --- 0. PRIORITY LANE: tracked-channel uploads, ahead of every discovery budget ------------
// A new upload on a channel we already watch is not discovery, so it is not capped by discovery
// and it is not queued behind a back-catalogue backfill. lib/nightly/priority-lane.ts carries
// the full incident note (BPS.space PpwewkOCFuE, 2026-09-03) and the definition of "covered".
// This block runs BEFORE the DISCOVERY_DAILY_CAP / GLOBAL_FLOOR exits below, on its own
// 200-id/run budget charged to quota_ledger category 'tracked-upload'.

/** The channels rss-poll polls and websub-subscribe subscribes, restricted to `ids`. */
async function loadCoveredChannels(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const res = await pool.query(
    `select channel_id from channel_rss_state where channel_id = any($1)
     union select youtube_channel_id from competitor_youtube_channels where youtube_channel_id = any($1)
     union select channel_id from discovered_channels where channel_id = any($1)`,
    [ids]
  );
  return new Set(res.rows.map((r: any) => r.channel_id));
}

let priorityImported = 0;
let priorityQuota = 0;
{
  // Newest sighting first, and its OWN query: the discovery lane's `order by id limit 1000` put
  // ~17K back-catalogue rows in front of every new upload.
  const { rows: pending } = await pool.query(
    `select id, kind, ref, mode, source_url, seen_at from touch_queue
      where processed_at is null and kind = 'video' and mode = any($1)
      order by seen_at desc, id desc limit $2`,
    [[...PRIORITY_MODES], PRIORITY_LANE.scanLimit]
  );
  if (pending.length) {
    const have = new Set<string>();
    for (const group of chunk(pending, 500)) {
      const r = await pool.query(`select id from videos where id = any($1)`, [group.map((x: any) => x.ref)]);
      r.rows.forEach((x: any) => have.add(x.id));
    }
    // Membership is only ever tested for channels a source_url actually names, so the covered
    // lookup is an `= any($1)` probe, never a scan of all ~6K watched channels every 5 minutes.
    const namedChannels = [...new Set(pending.map((r: any) => channelFromSourceUrl(r.source_url)).filter(Boolean))] as string[];
    const covered = await loadCoveredChannels(namedChannels);
    const { priority, overflow } = selectPriorityRows(pending as any, covered, have);

    // Rows for videos we already hold cost nothing to retire, and leaving them pending is how
    // the BPS.space row sat unprocessed for eleven hours.
    const settled = (pending as any[]).filter((r) => have.has(r.ref)).map((r) => r.id);
    if (settled.length) {
      await pool.query(`update touch_queue set processed_at = now(), result = 'already-tracked' where id = any($1)`, [settled]);
    }

    if (priority.length) {
      const before = quota;
      const items = orderByPublishedDesc(await fetchVideos(priority.map((r) => r.ref)));
      priorityQuota = quota - before;
      quota = before; // charged to 'tracked-upload' below, never to 'discovery'
      const fetchedChannels = [...new Set(items.map((v: any) => v.snippet?.channelId).filter(Boolean))] as string[];
      const coveredNow = await loadCoveredChannels(fetchedChannels);
      const done: number[] = [];
      for (const v of items) {
        if (job.signal.aborted) break;
        const row = priority.find((r) => r.ref === v.id);
        if (!row) continue;
        // Channel-less extension rows were admitted on spec; only import the ones the fetch
        // proves are on a watched channel. The rest fall through to the discovery lane below,
        // still pending, exactly as before.
        if (!isPriorityImport(v.snippet?.channelId, coveredNow)) continue;
        if (await insertVideo(v, 0)) priorityImported++;
        done.push(row.id);
      }
      if (done.length) {
        await pool.query(`update touch_queue set processed_at = now(), result = 'imported' where id = any($1)`, [done]);
      }
      if (priorityQuota) {
        await pool.query(`insert into quota_ledger (category, units) values ($1, $2)`,
          [PRIORITY_LANE.quotaCategory, priorityQuota]).catch(() => {});
        await pool.query(
          `insert into youtube_quota_usage (date, quota_used) values (current_date, $1)
           on conflict (date) do update set quota_used = youtube_quota_usage.quota_used + $1`, [priorityQuota]
        ).catch(() => {});
      }
      console.log(
        `priority lane: ${priority.length} tracked-upload ids fetched (${quotaUnits(priority.length)} expected units, ` +
        `${priorityQuota} spent), ${priorityImported} imported, ${overflow.length} over budget, ${settled.length} already tracked`
      );
    }
  }
}

// Budget guards: discovery has a daily cap so browsing can never starve the
// snapshot/ingest machinery; a global floor protects the whole bucket.
const DISCOVERY_DAILY_CAP = 2000;
const GLOBAL_FLOOR = 9000; // stop all discovery once total quota passes this
const [{ spent }] = (await pool.query(
  `select coalesce(sum(units),0)::int as spent from quota_ledger where date=current_date and category='discovery'`
)).rows;
// Scalar subquery: always returns exactly one row, even before the Pacific-
// midnight reset cron has seeded today's youtube_quota_usage row (a bare
// WHERE date=current_date returns ZERO rows 7 PM–3 AM ET and the destructure
// crashed every 5-min run in that window).
const [{ total }] = (await pool.query(
  `select coalesce((select quota_used from youtube_quota_usage where date=current_date), 0)::int as total`
)).rows;
if (spent >= DISCOVERY_DAILY_CAP) { console.log(`discovery cap reached (${spent}/${DISCOVERY_DAILY_CAP}); queue holds until tomorrow`); await pool.end(); job.finish(); process.exit(0); }
if (total >= GLOBAL_FLOOR) { console.log(`global quota floor reached (${total}); discovery paused`); await pool.end(); job.finish(); process.exit(0); }

const { rows } = await pool.query(
  `select id, kind, ref, mode, source_url from touch_queue where processed_at is null order by id limit 1000`
);
if (!rows.length) { console.log('queue empty'); await pool.end(); job.finish(); process.exit(0); }

// --- 1. Resolve refs to channel ids / video ids, skipping already-known ---
const videoRows = rows.filter((r) => r.kind === 'video');
const known = new Set<string>();
for (const group of chunk(videoRows, 500)) {
  if (job.signal.aborted) break;
  const res = await pool.query(`select id from videos where id = any($1)`, [group.map((r) => r.ref)]);
  res.rows.forEach((r) => known.add(r.id));
}
const newVideoRows = videoRows.filter((r) => !known.has(r.ref));

// --- 1b. WebSub wake-up (two-lane watcher, plan section 3) ---------------------------------
// A push is a doorbell, not a confirmed change: it says "look at this channel now", and the RSS
// poll is what confirms what actually changed. So we only (a) wake the channel so the next
// rss-poll tick reads its feed, and (b) if the push is about a video we ALREADY have — i.e. an
// edit, not an upload — mark it due now for the thumbnail watcher by stamping the latest
// thumbnail_versions.last_checked to 'epoch', which beats every recheck window in every tier.
const websubRows = rows.filter((r) => r.kind === 'video' && r.mode === 'websub');
const wokenChannels = [...new Set(
  websubRows.map((r) => /^websub:(UC[A-Za-z0-9_-]{22})$/.exec(r.source_url || '')?.[1]).filter(Boolean)
)] as string[];
if (wokenChannels.length) {
  await pool.query(
    `insert into channel_rss_state (channel_id, rss_state, rss_last_polled)
     select unnest($1::text[]), 'woken', null
     on conflict (channel_id) do update set rss_state = 'woken', rss_last_polled = null, updated_at = now()`,
    [wokenChannels]
  ).catch((e) => console.error(`websub wake-up failed: ${e.message}`));
}
const editedVideos = websubRows.filter((r) => known.has(r.ref)).map((r) => r.ref);
if (editedVideos.length) {
  const marked = await pool.query(
    `update thumbnail_versions t set last_checked = 'epoch'
      where t.video_id = any($1)
        and t.version = (select max(t2.version) from thumbnail_versions t2 where t2.video_id = t.video_id)`,
    [editedVideos]
  ).catch(() => ({ rowCount: 0 }));
  console.log(`WebSub: woke ${wokenChannels.length} channels, marked ${marked.rowCount} edited videos due now`);
} else if (wokenChannels.length) {
  console.log(`WebSub: woke ${wokenChannels.length} channels`);
}

const channelIds = new Map<number, string | null>();
for (const r of rows.filter((x) => x.kind === 'channel')) channelIds.set(r.id, r.ref);
for (const h of rows.filter((x) => x.kind === 'handle')) {
  if (job.signal.aborted) break;
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(h.ref)}&key=${API_KEY}`
  );
  quota++;
  channelIds.set(h.id, res.ok ? ((await res.json()) as any).items?.[0]?.id || null : null);
}

// --- 2. Video rows: every video we see imports, whichever door it came in through
// (lib/nightly/touch-decision.ts; click also enrolls the channel). A feed/passive sighting
// from a channel in none of our registries ALSO surfaces that channel as a candidate so it
// gets enrolled. TOUCH_IMPORT_TRACKED_ONLY=1 is the back-off knob for API budget: with it,
// unknown-channel feed sightings go back to being signals only.
const trackedOnly = process.env.TOUCH_IMPORT_TRACKED_ONLY === '1';
let imported = 0;
let candidatesSeen = 0;
const candidateChannels = new Map<string, number>(); // channelId -> times seen this drain
const decisions = new Map<number, TouchResult>(); // queue id -> what we did with it
const vids = await fetchVideos(newVideoRows.map((r) => r.ref));
const vidChannels = await loadKnownChannels([...new Set(vids.map((v) => v.snippet?.channelId).filter(Boolean))] as string[]);
for (const v of vids) {
  if (job.signal.aborted) break;
  const row = newVideoRows.find((r) => r.ref === v.id);
  if (!row) continue;
  const d = decideVideoRow({ mode: row.mode, ref: row.ref, channelId: v.snippet?.channelId }, known, vidChannels, { trackedOnly });
  decisions.set(row.id, d.result);
  if (d.result === 'imported') {
    if (await insertVideo(v, d.tier ?? 1)) imported++;
    if (row.mode === 'click' && v.snippet?.channelId) channelIds.set(row.id, v.snippet.channelId);
  }
  if (d.unknownChannel && (row.mode === 'feed' || row.mode === 'passive') && v.snippet?.channelId) {
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
    if (job.signal.aborted) break;
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
const knownChannels = await loadKnownChannels(uniqueChannels);
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
  if (job.signal.aborted) break;
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
    if (job.signal.aborted) break;
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
  if (job.signal.aborted) break;
  const ch = channelIds.get(r.id);
  const result =
    r.kind === 'video'
      ? known.has(r.ref) ? 'already-tracked'
        : decisions.get(r.id)
          // The videos API returned nothing for it (private/deleted): nothing was imported.
          ?? ((r.mode === 'click' || r.mode === 'websub') ? 'unfetched' : 'candidate-signal')
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
  `Drained ${rows.length} rows: ${priorityImported} tracked-channel uploads (priority lane), ${imported} clicked videos imported, ${candidatesSeen} channel candidates surfaced, ${channelsEnrolled} channels enrolled (+${channelVideos} videos), ${quota} quota units`
);
await pool.end();
job.finish();
