// Gap backfill over DIRECT Postgres (egress-clean). Walks uploads playlists for
// the channels listed in BACKFILL_CHANNELS_FILE, imports missing videos.
// Usage: BACKFILL_CHANNELS_FILE=/path npx tsx scripts/backfill-direct.ts [maxPagesPerChannel]
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import fs from 'fs';
import pg from 'pg';
import { chunk } from '../lib/nightly/tracking-core';

const maxPages = parseInt(process.argv[2] || '12', 10);
const API_KEY = process.env.YOUTUBE_API_KEY!;

function isShortDuration(dur: string | null | undefined): boolean {
  if (!dur) return false;
  const m = dur.match(/^PT(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return false; // has hours -> not a short
  const secs = (parseInt(m[1] || '0', 10)) * 60 + parseInt(m[2] || '0', 10);
  return secs <= 62;
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

const channels = fs.readFileSync(process.env.BACKFILL_CHANNELS_FILE!, 'utf8')
  .split('\n').map((s) => s.trim()).filter(Boolean);
console.log(`Channels: ${channels.length}`);

let quota = 0;
const missing: string[] = [];
let done = 0;
for (const ch of channels) {
  let pageToken = '';
  for (let page = 0; page < maxPages; page++) {
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=UU${ch.slice(2)}&maxResults=50${pageToken ? `&pageToken=${pageToken}` : ''}&key=${API_KEY}`;
    const res = await fetch(url);
    quota++;
    if (!res.ok) break;
    const json: any = await res.json();
    const ids: string[] = (json.items || []).map((i: any) => i.contentDetails.videoId);
    if (!ids.length) break;
    const known = await pool.query(`select id from videos where id = any($1)`, [ids]);
    const knownSet = new Set(known.rows.map((r) => r.id));
    const fresh = ids.filter((id) => !knownSet.has(id));
    missing.push(...fresh);
    if (!fresh.length || knownSet.size >= ids.length - 2) break;
    pageToken = json.nextPageToken;
    if (!pageToken) break;
  }
  if (++done % 50 === 0) console.log(`[${done}/${channels.length}] missing so far: ${missing.length} (quota ${quota})`);
}
console.log(`Missing: ${missing.length}; playlist quota: ${quota}`);

let inserted = 0;
for (const group of chunk(missing, 50)) {
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${group.join(',')}&key=${API_KEY}`
  );
  quota++;
  if (!res.ok) { console.error(`videos.list ${res.status}; stopping`); break; }
  const data: any = await res.json();
  for (const v of data.items || []) {
    if (isShortDuration(v.contentDetails?.duration)) continue; // longform corpus only
    const sn = v.snippet || {}; const st = v.statistics || {};
    try {
      await pool.query(
        `insert into videos (id, title, description, channel_id, channel_name, published_at,
                             view_count, like_count, comment_count, duration, thumbnail_url,
                             data_source, is_competitor, import_date, updated_at, user_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'competitor',true,now(),now(),'00000000-0000-0000-0000-000000000000')
         on conflict (id) do nothing`,
        [v.id, sn.title || '', (sn.description || '').slice(0, 50000), sn.channelId, sn.channelTitle || '',
         sn.publishedAt, parseInt(st.viewCount || '0', 10), parseInt(st.likeCount || '0', 10),
         parseInt(st.commentCount || '0', 10), v.contentDetails?.duration || null,
         sn.thumbnails?.maxres?.url || sn.thumbnails?.high?.url || null]
      );
      await pool.query(
        `insert into view_snapshots (video_id, snapshot_date, view_count, like_count, comment_count, days_since_published)
         values ($1, current_date, $2, $3, $4, (current_date - $5::date)) on conflict do nothing`,
        [v.id, parseInt(st.viewCount || '0', 10), parseInt(st.likeCount || '0', 10), parseInt(st.commentCount || '0', 10), sn.publishedAt]
      );
      await pool.query(
        `insert into view_tracking_priority (video_id, priority_tier, next_track_date)
         values ($1, 2, current_date + 1) on conflict (video_id) do nothing`,
        [v.id]
      );
      inserted++;
    } catch (e: any) { console.error(`${v.id}: ${e.message}`); }
  }
  if (inserted % 2500 < 50) console.log(`inserted ${inserted}/${missing.length}`);
}

await pool.query(
  `insert into youtube_quota_usage (date, quota_used) values (current_date, $1)
   on conflict (date) do update set quota_used = youtube_quota_usage.quota_used + $1`, [quota]
).catch(() => {});
console.log(`Done. ${inserted} inserted, ${quota} quota units.`);
await pool.end();
