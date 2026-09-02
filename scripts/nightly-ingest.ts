// Nightly new-video ingest over the DIRECT Postgres connection (unmetered).
// RSS feeds (free) -> diff against videos table -> batched videos.list -> insert.
// Baselines/scores are computed by the existing server-side pg_cron jobs.
// Usage: npx tsx scripts/nightly-ingest.ts [maxChannels]
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import { clampCount, chunk, parseRssVideoIds } from '../lib/nightly/tracking-core';
import { planEnrollment, KnownChannels } from '../lib/nightly/enrollment-core';

const maxChannels = parseInt(process.argv[2] || '0', 10);
const API_KEY = process.env.YOUTUBE_API_KEY!;

function isShortDuration(dur: string | null | undefined): boolean {
  if (!dur) return false;
  const m = dur.match(/^PT(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return false; // has hours -> not a short
  const secs = (parseInt(m[1] || '0', 10)) * 60 + parseInt(m[2] || '0', 10);
  return secs <= 62;
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

// Step 0: drain the touch_queue (Chrome extension click/passive captures).
// Resolve everything to channel IDs, enroll in discovered_channels so the RSS
// sweep below picks them up, and mark rows processed.
async function drainTouchQueue(): Promise<number> {
  const { rows } = await pool.query(
    `select id, kind, ref from touch_queue where processed_at is null limit 500`
  );
  if (!rows.length) return 0;
  const resolved = new Map<number, string | null>(); // queue id -> channel id

  const handles = rows.filter((r) => r.kind === 'handle');
  for (const h of handles) {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(h.ref)}&key=${API_KEY}`
    );
    const d: any = res.ok ? await res.json() : {};
    resolved.set(h.id, d.items?.[0]?.id || null);
  }

  const vids = rows.filter((r) => r.kind === 'video');
  for (const group of chunk(vids, 50)) {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${group.map((r) => r.ref).join(',')}&key=${API_KEY}`
    );
    const d: any = res.ok ? await res.json() : {};
    const byId = new Map((d.items || []).map((v: any) => [v.id, v.snippet?.channelId]));
    for (const r of group) resolved.set(r.id, (byId.get(r.ref) as string) || null);
  }

  for (const r of rows.filter((x) => x.kind === 'channel')) resolved.set(r.id, r.ref);

  // Enrich resolved channels (title is NOT NULL in discovered_channels)
  const uniqueChannels = [...new Set([...resolved.values()].filter(Boolean))] as string[];
  const meta = new Map<string, any>();
  for (const group of chunk(uniqueChannels, 50)) {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${group.join(',')}&key=${API_KEY}`
    );
    const d: any = res.ok ? await res.json() : {};
    for (const c of d.items || []) meta.set(c.id, c);
  }

  // "Tracked" = present in ANY registry (competitor, discovered, legacy
  // channels, or the corpus itself). Enrolling across registries is the
  // duplicate-tracking bug — see lib/nightly/enrollment-core.test.ts.
  const known: KnownChannels = {
    competitor: new Set(), discovered: new Set(), legacy: new Set(), withVideos: new Set(),
  };
  if (uniqueChannels.length) {
    const [comp, disc, leg, wv] = await Promise.all([
      pool.query(`select youtube_channel_id id from competitor_youtube_channels where youtube_channel_id = any($1)`, [uniqueChannels]),
      pool.query(`select channel_id id from discovered_channels where channel_id = any($1)`, [uniqueChannels]),
      pool.query(`select channel_id id from channels where channel_id = any($1)`, [uniqueChannels]),
      pool.query(`select distinct channel_id id from videos where channel_id = any($1)`, [uniqueChannels]),
    ]);
    for (const r of comp.rows) known.competitor.add(r.id);
    for (const r of disc.rows) known.discovered.add(r.id);
    for (const r of leg.rows) known.legacy.add(r.id);
    for (const r of wv.rows) known.withVideos.add(r.id);
  }

  const plan = planEnrollment(
    [...resolved].map(([queueId, channelId]) => ({ queueId, channelId })),
    known
  );

  let enrolled = 0;
  for (const chId of plan.toEnroll) {
    const m = meta.get(chId);
    if (!m) continue;
    const ins = await pool.query(
      `insert into discovered_channels (channel_id, channel_title, channel_handle, subscriber_count, video_count, view_count, discovery_method)
       values ($1,$2,$3,$4,$5,$6,'touch_queue') on conflict (channel_id) do nothing`,
      [chId, m.snippet?.title || chId, m.snippet?.customUrl || null,
       clampCount(parseInt(m.statistics?.subscriberCount || '0', 10)),
       clampCount(parseInt(m.statistics?.videoCount || '0', 10)),
       clampCount(parseInt(m.statistics?.viewCount || '0', 10))]
    ).catch((e) => { console.error(`enroll ${chId}: ${e.message}`); return { rowCount: 0 }; });
    if (ins.rowCount) enrolled++;
  }

  for (const [qid, label] of plan.results) {
    await pool.query(
      `update touch_queue set processed_at = now(), result = $2 where id = $1`,
      [qid, label]
    );
  }
  const already = [...plan.results.values()].filter((v) => v.startsWith('already-tracked')).length;
  console.log(`Touch queue: ${rows.length} processed, ${enrolled} new channels enrolled, ${already} already tracked`);
  return enrolled;
}
await drainTouchQueue();

const chRes = await pool.query(
  `select distinct youtube_channel_id as id from competitor_youtube_channels where youtube_channel_id like 'UC%'
   union
   select distinct channel_id from discovered_channels where channel_id like 'UC%'`
);
let channels: string[] = chRes.rows.map((r) => r.id);
if (maxChannels > 0) channels = channels.slice(0, maxChannels);
console.log(`Checking RSS for ${channels.length} channels...`);

// 1. RSS sweep (free, concurrent)
const candidateIds = new Set<string>();
for (const group of chunk(channels, 25)) {
  await Promise.all(
    group.map(async (ch) => {
      try {
        const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch}`, {
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) return;
        parseRssVideoIds(await res.text()).forEach((id) => candidateIds.add(id));
      } catch {
        /* dead feed; skip */
      }
    })
  );
}
console.log(`RSS candidates: ${candidateIds.size}`);

// 2. Diff against DB
const cand = [...candidateIds];
const newIds: string[] = [];
for (const group of chunk(cand, 5000)) {
  const known = await pool.query(`select id from videos where id = any($1)`, [group]);
  const knownSet = new Set(known.rows.map((r) => r.id));
  newIds.push(...group.filter((id) => !knownSet.has(id)));
}
console.log(`New videos: ${newIds.length}`);

// 3. Fetch metadata in batches of 50 and insert
let apiCalls = 0;
let inserted = 0;
for (const group of chunk(newIds, 50)) {
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${group.join(',')}&key=${API_KEY}`
  );
  apiCalls++;
  if (!res.ok) {
    console.error(`YouTube API error ${res.status}; stopping.`);
    break;
  }
  const data: any = await res.json();
  for (const v of data.items || []) {
    if (isShortDuration(v.contentDetails?.duration)) continue; // longform corpus only
    const sn = v.snippet || {};
    const st = v.statistics || {};
    try {
      await pool.query(
        `insert into videos (id, title, description, channel_id, channel_name, published_at,
                             view_count, like_count, comment_count, duration, thumbnail_url,
                             data_source, is_competitor, import_date, updated_at, user_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'competitor',true,now(),now(),'00000000-0000-0000-0000-000000000000')
         on conflict (id) do nothing`,
        [
          v.id,
          sn.title || '',
          (sn.description || '').slice(0, 50000),
          sn.channelId,
          sn.channelTitle || '',
          sn.publishedAt,
          clampCount(parseInt(st.viewCount || '0', 10)),
          clampCount(parseInt(st.likeCount || '0', 10)),
          clampCount(parseInt(st.commentCount || '0', 10)),
          v.contentDetails?.duration || null,
          sn.thumbnails?.maxres?.url || sn.thumbnails?.high?.url || null,
        ]
      );
      await pool.query(
        `insert into view_snapshots (video_id, snapshot_date, view_count, like_count, comment_count, days_since_published)
         values ($1, current_date, $2, $3, $4, (current_date - $5::date))
         on conflict (video_id, snapshot_date) do nothing`,
        [v.id, clampCount(parseInt(st.viewCount || '0', 10)), clampCount(parseInt(st.likeCount || '0', 10)), clampCount(parseInt(st.commentCount || '0', 10)), sn.publishedAt]
      );
      await pool.query(
        `insert into view_tracking_priority (video_id, priority_tier, next_track_date)
         values ($1, 1, current_date + 1) on conflict (video_id) do nothing`,
        [v.id]
      );
      inserted++;
    } catch (e: any) {
      console.error(`insert failed for ${v.id}: ${e.message}`);
    }
  }
}

await pool.query(
  `insert into youtube_quota_usage (date, quota_used) values (current_date, $1)
   on conflict (date) do update set quota_used = youtube_quota_usage.quota_used + $1`,
  [apiCalls]
).catch((e) => console.warn('quota log skipped:', e.message));
await pool.query(`insert into quota_ledger (category, units) values ('ingest', $1)`, [apiCalls]).catch(() => {});
// Fold tonight's new channels/videos into the add-channel search view (sql/channel-directory.sql).
await pool.query('select refresh_channel_directory()').catch((e: any) => console.error('channel_directory refresh:', e.message));

console.log(`Done. ${inserted} new videos inserted, ${apiCalls} YouTube API units used.`);
await pool.end();
