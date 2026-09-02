// One-off + safety net: compute phash for archived thumbnail versions that lack one, then collapse
// consecutive versions that are the same picture (CDN re-encodes) and renumber per video.
// Usage: npx tsx scripts/thumbnail-phash-backfill.ts [--collapse]
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { chunk } from '../lib/nightly/tracking-core';
import { phashFromJpeg, pixelMeanDiff } from '../lib/thumbs/decode';
import { isSamePicture } from '../lib/thumbs/phash';

const COLLAPSE = process.argv.includes('--collapse');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
pool.on('connect', (c: pg.PoolClient) => { c.query('set statement_timeout = 300000').catch(() => {}); });
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

// 0. repair: rows whose storage_path file version disagrees with the row's version (earlier renumbering) -> rename file
const misaligned = (await pool.query(`select id, video_id, version, storage_path from thumbnail_versions where storage_path is not null and storage_path !~ ('_v' || version || '\\.jpg$')`)).rows as any[];
let repaired = 0;
for (const r of misaligned) {
  const from = path.join(process.cwd(), r.storage_path), to = path.join(process.cwd(), `data/thumbnails/${r.video_id}_v${r.version}.jpg`);
  if (fs.existsSync(from) && !fs.existsSync(to)) { fs.renameSync(from, to); repaired++; }
  if (fs.existsSync(to)) await pool.query(`update thumbnail_versions set storage_path = $1 where id = $2`, [`data/thumbnails/${r.video_id}_v${r.version}.jpg`, r.id]);
}
log(`repair: ${misaligned.length} misaligned rows, ${repaired} files renamed`);

// 1. backfill phash from the local archive
const missing = (await pool.query(`select id, video_id, version, storage_path from thumbnail_versions where phash is null order by video_id, version`)).rows as any[];
log(`backfill: ${missing.length} versions without phash`);
let done = 0, noFile = 0;
for (const group of chunk(missing, 200)) {
  const updates: [string, number][] = [];
  await Promise.all(group.map(async (r) => {
    const f = path.join(process.cwd(), r.storage_path || `data/thumbnails/${r.video_id}_v${r.version}.jpg`);
    if (!fs.existsSync(f)) { noFile++; return; }
    try { updates.push([await phashFromJpeg(fs.readFileSync(f)), r.id]); } catch { noFile++; }
  }));
  if (updates.length) {
    const vals = updates.map((_, i) => `($${i * 2 + 1}::text, $${i * 2 + 2}::bigint)`).join(',');
    await pool.query(`update thumbnail_versions t set phash = u.p from (values ${vals}) as u(p, id) where t.id = u.id`, updates.flat());
    done += updates.length;
  }
}
log(`backfill: ${done} hashed, ${noFile} without a local file`);

// 2. collapse: per video, walk versions in order; drop any version that is the same picture as the last KEPT one
if (COLLAPSE) {
  const rows = (await pool.query(`select id, video_id, version, phash, sha256 from thumbnail_versions where video_id in (select video_id from thumbnail_versions where version > 1) order by video_id, version`)).rows as any[];
  const byVideo = new Map<string, any[]>();
  for (const r of rows) { if (!byVideo.has(r.video_id)) byVideo.set(r.video_id, []); byVideo.get(r.video_id)!.push(r); }
  let deleted = 0, videosTouched = 0;
  for (const [vid, vs] of byVideo) {
    const keep: any[] = []; const drop: any[] = [];
    for (const v of vs) {
      const last = keep[keep.length - 1];
      let same = false;
      if (last) {
        if (v.sha256 === last.sha256) same = true;
        else if (v.phash && last.phash) {
          let md: number | null = null;
          const fa = path.join(process.cwd(), `data/thumbnails/${vid}_v${last.version}.jpg`), fb = path.join(process.cwd(), `data/thumbnails/${vid}_v${v.version}.jpg`);
          if (fs.existsSync(fa) && fs.existsSync(fb)) { try { md = await pixelMeanDiff(fs.readFileSync(fa), fs.readFileSync(fb)); } catch { /* null */ } }
          same = isSamePicture(last.phash, v.phash, md);
        }
      }
      (same ? drop : keep).push(v);
    }
    if (!drop.length) continue;
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`delete from thumbnail_versions where id = any($1::bigint[])`, [drop.map((d) => d.id)]);
      // renumber kept versions 1..n (two-phase to dodge the unique (video_id, version) constraint)
      for (let i = 0; i < keep.length; i++) await client.query(`update thumbnail_versions set version = $1 where id = $2`, [-(i + 1), keep[i].id]);
      for (let i = 0; i < keep.length; i++) {
        const from = path.join(process.cwd(), `data/thumbnails/${vid}_v${keep[i].version}.jpg`), to = path.join(process.cwd(), `data/thumbnails/${vid}_v${i + 1}.jpg`);
        if (keep[i].version !== i + 1 && fs.existsSync(from)) { try { fs.renameSync(from, to + '.tmp'); } catch { /* ignore */ } }
        await client.query(`update thumbnail_versions set version = $1, storage_path = $3 where id = $2`, [i + 1, keep[i].id, `data/thumbnails/${vid}_v${i + 1}.jpg`]);
      }
      for (let i = 0; i < keep.length; i++) { const t = path.join(process.cwd(), `data/thumbnails/${vid}_v${i + 1}.jpg.tmp`); if (fs.existsSync(t)) fs.renameSync(t, t.replace(/\.tmp$/, '')); }
      for (const d of drop) { const f = path.join(process.cwd(), `data/thumbnails/${vid}_v${d.version}.jpg`); if (fs.existsSync(f)) { try { fs.unlinkSync(f); } catch { /* ignore */ } } }
      await client.query(`update track_schedule set last_version_seen = least(last_version_seen, $1) where video_id = $2`, [keep.length, vid]);
      await client.query('commit');
      deleted += drop.length; videosTouched++;
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
  }
  log(`collapse: removed ${deleted} re-encode versions across ${videosTouched} videos`);
}
await pool.end();
