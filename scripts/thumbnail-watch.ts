// Thumbnail change watcher: detects packaging swaps (manual changes and
// Test & Compare winners) by polling YouTube's image CDN — ZERO Data API quota.
// Watch policy lives in lib/thumbs/watch-policy.ts: launch <6h every run, hot 6-72h
// every ~30 min, warm 3-30d daily, cool 30-90d weekly, cold >90d monthly. Every distinct
// image version is hashed and archived to data/thumbnails/ so packaging history is preserved.
// Hot tiers are selected first and long-tail work is separately capped, so the long tail
// can never crowd the launch window out of the per-run budget.
// Usage: npx tsx scripts/thumbnail-watch.ts [maxVideos] [--dry] [--long-tail]
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
import {
  HOT_TARGETS_SQL,
  LONG_TAIL_TARGETS_SQL,
  TIER_COUNTS_SQL,
  LONG_TAIL_MAX_PER_RUN,
  isLongTailRun,
} from '../lib/thumbs/watch-policy';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const forceLongTail = args.includes('--long-tail');
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
  const { rows } = await pool.query(TIER_COUNTS_SQL);
  const order = ['launch', 'hot', 'warm', 'cool', 'cold'];
  console.log('tier    total      due now');
  for (const t of order) {
    const r = rows.find((x: any) => x.tier === t);
    console.log(`${t.padEnd(8)}${String(r?.total ?? 0).padStart(8)}${String(r?.due ?? 0).padStart(13)}`);
  }
  console.log(`(long tail cap ${LONG_TAIL_MAX_PER_RUN}/run, runs hourly; long-tail slot now: ${isLongTailRun(new Date())})`);
  await pool.end();
  process.exit(0);
}

// Hot tiers first: they always get the budget they need.
const { rows: hot } = await pool.query(HOT_TARGETS_SQL, [maxVideos]);
let targets = hot;
// Long tail fills whatever is left, capped, and only on the first LaunchAgent slot of the hour
// (its anti-join spans ~850K rows; this DB has had IO incidents).
if (isLongTailRun(new Date()) || forceLongTail) {
  const budget = Math.min(LONG_TAIL_MAX_PER_RUN, Math.max(0, maxVideos - hot.length));
  if (budget > 0) {
    const { rows: tail } = await pool.query(LONG_TAIL_TARGETS_SQL, [budget]);
    targets = hot.concat(tail);
    console.log(`Hot tiers: ${hot.length}; long tail: ${tail.length}`);
  }
}
console.log(`Watching ${targets.length} videos`);

let checked = 0;
let changes = 0;
let news = 0;
let shorts = 0;
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
          `select version, sha256, phash from thumbnail_versions where video_id=$1 order by version desc limit 1`,
          [id]
        );
        if (cur.length && cur[0].sha256 === sha) {
          await pool.query(`update thumbnail_versions set last_checked=now() where video_id=$1 and version=$2`, [id, cur[0].version]);
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
          await pool.query(`update thumbnail_versions set last_checked=now(), phash=coalesce(phash,$3) where video_id=$1 and version=$2`, [id, cur[0].version, phash]);
          return;
        }
        const version = cur.length ? cur[0].version + 1 : 1;
        const file = path.join(STORE, `${id}_v${version}.jpg`);
        fs.writeFileSync(file, buf);
        const uploaded = await uploadThumb(id, version, buf).catch(() => false);
        await pool.query(
          `insert into thumbnail_versions (video_id, version, sha256, bytes, storage_path, phash, r2_uploaded_at)
           values ($1,$2,$3,$4,$5,$6, case when $7 then now() end) on conflict do nothing`,
          [id, version, sha, buf.length, path.relative(process.cwd(), file), phash, uploaded]
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
console.log(`Done. ${checked} checked, ${news} first-captures, ${changes} CHANGES detected, ${shorts} flagged as Shorts.`);
await pool.end();
