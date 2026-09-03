// Thumbnail change watcher: detects packaging swaps (manual changes and
// Test & Compare winners) by polling YouTube's image CDN — ZERO Data API quota.
// Watch policy lives in lib/thumbs/watch-policy.ts, which holds TWO ladders while the
// two-lane watcher is on trial: videos on a watch_subset channel get the new cadence
// (<24h every run, 1-3d 15m, 3-14d 30m, 14-30d 2h, 30-90d daily, >90d weekly); everything
// else keeps the old one (<6h every run, 6-72h 25m, 3-30d 23h, 30-90d weekly, >90d monthly).
// WATCH_SUBSET=1 / --subset turns that gate on; with it off every video runs the new ladder.
// Every distinct image version is hashed and archived to data/thumbnails/ so packaging history
// is preserved. Hot tiers are selected first and long-tail work is separately capped, so the
// long tail can never crowd the launch window out of the per-run budget.
// Conditional fetch: i.ytimg.com sends an ETag, so a video whose image is unchanged costs a
// 304 with no body. "Due now" marks (RSS poller / WebSub) arrive as last_checked = 'epoch'.
// Usage: npx tsx scripts/thumbnail-watch.ts [maxVideos] [--dry] [--long-tail] [--subset]
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { chunk } from '../lib/nightly/tracking-core';
import { phashFromJpeg, pixelMeanDiff } from '../lib/thumbs/decode';
import { isShortByRedirect } from '../lib/thumbs/shorts';
import { isSamePicture } from '../lib/thumbs/phash';
import { uploadThumb } from '../lib/thumbs/storage';
import { recordTitleChange } from '../lib/rss/title-change';
import {
  HOT_TARGETS_SQL,
  LONG_TAIL_TARGETS_SQL,
  TIER_COUNTS_SQL,
  TIER_ORDER,
  LONG_TAIL_MAX_PER_RUN,
  isLongTailRun,
} from '../lib/thumbs/watch-policy';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const forceLongTail = args.includes('--long-tail');
// Subset gate: while the two-lane watcher is on trial, only watch_subset channels get the new
// (much denser) cadence. Everything else keeps exactly the cadence it had before.
const subset = args.includes('--subset') || process.env.WATCH_SUBSET === '1';
const maxVideos = parseInt(args.find((a) => /^\d+$/.test(a)) || '25000', 10);
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
});
// batch job: target selection legitimately scans the 30-day window; the 2min
// statement_timeout was killing it (57014). pgbouncer strips startup options,
// so SET per connection instead.
pool.on('connect', (c) => { c.query('set statement_timeout = 0').catch(() => {}); });
const STORE = path.join(path.dirname(new URL(import.meta.url).pathname), '../data/thumbnails');

if (dry) {
  const { rows } = await pool.query(TIER_COUNTS_SQL, [subset]);
  console.log(`gate: ${subset ? 'watch_subset only (new cadence), rest legacy' : 'new cadence for everything'}`);
  console.log('tier    total      due now');
  for (const t of TIER_ORDER) {
    const r = rows.find((x: any) => x.tier === t);
    console.log(`${t.padEnd(8)}${String(r?.total ?? 0).padStart(8)}${String(r?.due ?? 0).padStart(13)}`);
  }
  console.log(`(long tail cap ${LONG_TAIL_MAX_PER_RUN}/run, runs hourly; long-tail slot now: ${isLongTailRun(new Date())})`);
  await pool.end();
  process.exit(0);
}

// Hot tiers first: they always get the budget they need.
const { rows: hot } = await pool.query(HOT_TARGETS_SQL, [subset, maxVideos]);
let targets = hot;
// Long tail fills whatever is left, capped, and only on the first LaunchAgent slot of the hour
// (its anti-join spans ~850K rows; this DB has had IO incidents).
if (isLongTailRun(new Date()) || forceLongTail) {
  const budget = Math.min(LONG_TAIL_MAX_PER_RUN, Math.max(0, maxVideos - hot.length));
  if (budget > 0) {
    const { rows: tail } = await pool.query(LONG_TAIL_TARGETS_SQL, [subset, budget]);
    targets = hot.concat(tail);
    console.log(`Hot tiers: ${hot.length}; long tail: ${tail.length}`);
  }
}
console.log(`Watching ${targets.length} videos`);

let checked = 0;
let changes = 0;
let news = 0;
let shorts = 0;
let notModified = 0;
for (const group of chunk(targets, 20)) {
  await Promise.all(
    group.map(async ({ id }) => {
      try {
        // Read first: the stored ETag turns most checks into a bodyless 304.
        const { rows: cur } = await pool.query(
          `select version, sha256, phash, etag from thumbnail_versions where video_id=$1 order by version desc limit 1`,
          [id]
        );
        const res = await fetch(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, {
          headers: cur.length && cur[0].etag ? { 'If-None-Match': cur[0].etag } : {},
          signal: AbortSignal.timeout(10000),
        });
        if (res.status === 304) {
          notModified++;
          checked++;
          await pool.query(`update thumbnail_versions set last_checked=now() where video_id=$1 and version=$2`, [id, cur[0].version]);
          return;
        }
        if (!res.ok) return;
        const buf = Buffer.from(await res.arrayBuffer());
        checked++;
        const etag = res.headers.get('etag');
        const sha = crypto.createHash('sha256').update(buf).digest('hex');
        if (cur.length && cur[0].sha256 === sha) {
          await pool.query(
            `update thumbnail_versions set last_checked=now(), etag=coalesce($3, etag) where video_id=$1 and version=$2`,
            [id, cur[0].version, etag]
          );
          return;
        }
        // First capture: ask YouTube whether this is a Short (youtube.com/shorts/<id> routing).
        // Record the answer either way so lib/scoring/longform stops treating a short clip as unverified.
        if (!cur.length) {
          const short = await isShortByRedirect(id);
          if (short !== null) await pool.query(`update videos set is_short = $2, shorts_checked_at = now() where id = $1`, [id, short]);
          if (short === true) { shorts++; return; }
        }
        // Different bytes: only a CHANGE if the picture itself differs (CDN re-encodes flip sha256 with the same image).
        const phash = await phashFromJpeg(buf);
        let meanDiff: number | null = null;
        if (cur.length) {
          const prevFile = path.join(STORE, `${id}_v${cur[0].version}.jpg`);
          if (fs.existsSync(prevFile)) { try { meanDiff = await pixelMeanDiff(fs.readFileSync(prevFile), buf); } catch { /* keep null */ } }
        }
        if (cur.length && isSamePicture(cur[0].phash, phash, meanDiff)) {
          // Same picture, different bytes (CDN re-encode): the ETag moved, so store the new one.
          await pool.query(
            `update thumbnail_versions set last_checked=now(), phash=coalesce(phash,$3), etag=$4 where video_id=$1 and version=$2`,
            [id, cur[0].version, phash, etag]
          );
          return;
        }
        const version = cur.length ? cur[0].version + 1 : 1;
        const file = path.join(STORE, `${id}_v${version}.jpg`);
        fs.writeFileSync(file, buf);
        const uploaded = await uploadThumb(id, version, buf).catch(() => false);
        await pool.query(
          `insert into thumbnail_versions (video_id, version, sha256, bytes, storage_path, phash, r2_uploaded_at, etag)
           values ($1,$2,$3,$4,$5,$6, case when $7 then now() end, $8) on conflict do nothing`,
          [id, version, sha, buf.length, path.relative(process.cwd(), file), phash, uploaded, etag]
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
console.log(
  `Done. ${checked} checked (${notModified} x 304 not-modified), ${news} first-captures, ` +
  `${changes} CHANGES detected, ${shorts} flagged as Shorts.`
);

// --- oEmbed title check for videos the channel RSS window no longer covers ---
// RSS lists a channel's last 15 uploads, so anything still in that window is already covered by
// scripts/rss-poll.ts. Here we take the 14-90 day videos that have fallen out of it and diff the
// live title on the same tick as their CDN check. oEmbed is free and unauthenticated.
const OEMBED_MIN_AGE = "interval '14 days'";
const OEMBED_MAX_AGE = "interval '90 days'";
const { rows: oembedTargets } = await pool.query(
  `select v.id, v.title, v.published_at from videos v
    where v.id = any($2)
      and v.published_at <= now() - ${OEMBED_MIN_AGE}
      and v.published_at > now() - ${OEMBED_MAX_AGE}
      and (not $1::boolean or exists (select 1 from watch_subset ws where ws.channel_id = v.channel_id))
      -- still among the channel's last 15 uploads? then RSS has it; skip.
      and not exists (
        select 1 from (
          select v2.id from videos v2 where v2.channel_id = v.channel_id
           order by v2.published_at desc limit 15
        ) recent where recent.id = v.id
      )`,
  [subset, targets.map((t: { id: string }) => t.id)]
);
let oembedChecked = 0;
let oembedTitleChanges = 0;
for (const group of chunk(oembedTargets, 20)) {
  await Promise.all(group.map(async (v: { id: string; title: string; published_at: string }) => {
    try {
      const res = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${v.id}&format=json`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) return; // 401/404 = private or deleted; nothing to compare against
      oembedChecked++;
      const live = ((await res.json()) as { title?: string }).title;
      if (!live || !v.title || live === v.title) return;
      await recordTitleChange(pool, v.id, v.title, live, v.published_at, new Date());
      oembedTitleChanges++;
      console.log(`TITLE CHANGE (oEmbed) ${v.id}: "${v.title}" -> "${live}"`);
    } catch { /* transient */ }
  }));
}
if (oembedTargets.length) {
  console.log(`oEmbed titles: ${oembedChecked}/${oembedTargets.length} checked, ${oembedTitleChanges} changes.`);
}
await pool.end();
