// Throttled upload of the local thumbnail archive to R2 (via the thumbs Worker). Safe to re-run; skips
// versions already marked uploaded. Rate-limited so it never competes with the DB or the Mac.
// Usage: npx tsx scripts/thumbnail-r2-backfill.ts [perMinute=300] [max=0]
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { uploadThumb } from '../lib/thumbs/storage';

const perMinute = parseInt(process.argv[2] || '300', 10);
const max = parseInt(process.argv[3] || '0', 10);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

const rows = (await pool.query(
  `select id, video_id, version, storage_path from thumbnail_versions where r2_uploaded_at is null order by first_seen desc ${max ? `limit ${max}` : ''}`
)).rows as any[];
log(`backfill: ${rows.length} versions to upload at ${perMinute}/min`);
let ok = 0, missing = 0, failed = 0;
const gap = 60000 / perMinute;
for (const r of rows) {
  const t0 = Date.now();
  const f = path.join(process.cwd(), r.storage_path || `data/thumbnails/${r.video_id}_v${r.version}.jpg`);
  if (!fs.existsSync(f)) { missing++; }
  else if (await uploadThumb(r.video_id, r.version, fs.readFileSync(f)).catch(() => false)) {
    await pool.query(`update thumbnail_versions set r2_uploaded_at = now() where id = $1`, [r.id]); ok++;
  } else failed++;
  if ((ok + missing + failed) % 500 === 0) log(`progress ok=${ok} missing=${missing} failed=${failed}`);
  const wait = gap - (Date.now() - t0);
  if (wait > 0) await new Promise((res) => setTimeout(res, wait));
}
log(`done ok=${ok} missing=${missing} failed=${failed}`);
await pool.end();
