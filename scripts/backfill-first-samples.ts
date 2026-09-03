// One-shot: give videos that were imported without an observation their first view sample.
//
// Before lib/ingest/first-sample.ts, every import path wrote only a daily view_snapshots row
// (and some wrote nothing at all), so a video found by RSS days after publish could sit
// unmeasured until the next tracker tick — scripts/score-gaps.ts calls that bucket
// `no-observations`, and the scorer skips those videos outright. New imports no longer land
// there; this closes the ones already in the corpus.
//
//   npx tsx scripts/backfill-first-samples.ts [--days 90] [--limit 6000] [--dry]
// Cost: one videos.list unit per 50 videos.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import { chunk } from '../lib/nightly/tracking-core';
import { longformSql } from '../lib/scoring/longform';
import { ingestWrites } from '../lib/ingest/first-sample';

const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const DAYS = Number(arg('--days') ?? 90);
const LIMIT = Number(arg('--limit') ?? 6000);
const DRY = process.argv.includes('--dry');
const API_KEY = process.env.YOUTUBE_API_KEY!;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

const rows = (await pool.query(
  `select v.id from videos v
    where v.published_at > now() - ($1 || ' days')::interval
      and ${longformSql('v')}
      and not exists (select 1 from view_samples s where s.video_id = v.id)
      and not exists (select 1 from view_snapshots s where s.video_id = v.id)
    order by v.published_at desc limit $2`,
  [DAYS, LIMIT]
)).rows as { id: string }[];
log(`${rows.length} videos under ${DAYS}d with no observation at all${DRY ? ' (dry run)' : ''}`);

let quota = 0, written = 0, gone = 0;
for (const group of chunk(rows.map((r) => r.id), 50)) {
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${group.join(',')}&key=${API_KEY}`
  );
  quota++;
  if (!res.ok) { log(`videos.list failed: ${res.status}`); break; }
  const items = (((await res.json()) as any).items || []) as any[];
  gone += group.length - items.length; // private, deleted, or region-blocked
  for (const item of items) {
    if (DRY) { written++; continue; }
    // The response IS an observation at a known instant; write it as one.
    for (const w of ingestWrites(item, 1, new Date())) await pool.query(w.sql, w.params).catch(() => {});
    written++;
  }
  if (written % 1000 < 50) log(`progress ${written} written, ${gone} unavailable, ${quota} units`);
}
if (!DRY && quota) {
  await pool.query(
    `insert into youtube_quota_usage (date, quota_used) values (current_date, $1)
     on conflict (date) do update set quota_used = youtube_quota_usage.quota_used + $1`, [quota]
  ).catch(() => {});
  await pool.query(`insert into quota_ledger (category, units) values ('ingest', $1)`, [quota]).catch(() => {});
}
log(`done: ${written} sampled, ${gone} unavailable, ${quota} quota units`);
await pool.end();
