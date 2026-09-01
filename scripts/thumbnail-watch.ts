// Thumbnail change watcher: detects packaging swaps (manual changes and
// Test & Compare winners) by polling YouTube's image CDN — ZERO Data API quota.
// Watch policy: videos published <72h ago every run (30-min LaunchAgent),
// 3-30 days old once per day. Every distinct image version is hashed and
// archived to data/thumbnails/ so packaging history is preserved.
// Usage: npx tsx scripts/thumbnail-watch.ts [maxVideos]
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { chunk } from '../lib/nightly/tracking-core';

const maxVideos = parseInt(process.argv[2] || '25000', 10);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const STORE = path.join(path.dirname(new URL(import.meta.url).pathname), '../data/thumbnails');

const { rows: targets } = await pool.query(
  `with latest as (
     select distinct on (video_id) video_id, last_checked
     from thumbnail_versions order by video_id, version desc
   )
   select v.id from videos v
   left join latest l on l.video_id = v.id
   where v.published_at > now() - interval '30 days'
     and (
       v.published_at > now() - interval '6 hours'                  -- launch window: every 5-min run
       or (v.published_at > now() - interval '72 hours'
           and (l.video_id is null or l.last_checked < now() - interval '25 minutes'))  -- hot: ~30 min
       or l.video_id is null                                        -- never checked
       or l.last_checked < now() - interval '23 hours'              -- warm: daily
     )
   order by v.published_at desc
   limit $1`,
  [maxVideos]
);
console.log(`Watching ${targets.length} videos`);

let checked = 0;
let changes = 0;
let news = 0;
for (const group of chunk(targets, 20)) {
  await Promise.all(
    group.map(async ({ id }) => {
      try {
        const res = await fetch(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, {
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return;
        const buf = Buffer.from(await res.arrayBuffer());
        checked++;
        const sha = crypto.createHash('sha256').update(buf).digest('hex');
        const { rows: cur } = await pool.query(
          `select version, sha256 from thumbnail_versions where video_id=$1 order by version desc limit 1`,
          [id]
        );
        if (cur.length && cur[0].sha256 === sha) {
          await pool.query(
            `update thumbnail_versions set last_checked=now() where video_id=$1 and version=$2`,
            [id, cur[0].version]
          );
          return;
        }
        const version = cur.length ? cur[0].version + 1 : 1;
        const file = path.join(STORE, `${id}_v${version}.jpg`);
        fs.writeFileSync(file, buf);
        await pool.query(
          `insert into thumbnail_versions (video_id, version, sha256, bytes, storage_path)
           values ($1,$2,$3,$4,$5) on conflict do nothing`,
          [id, version, sha, buf.length, path.relative(process.cwd(), file)]
        );
        if (version === 1) news++;
        else {
          changes++;
          console.log(`THUMBNAIL CHANGE: ${id} -> v${version}`);
        }
      } catch { /* transient */ }
    })
  );
}
console.log(`Done. ${checked} checked, ${news} first-captures, ${changes} CHANGES detected.`);
await pool.end();
