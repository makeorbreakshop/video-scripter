// Ask YouTube whether each unverified <=180s video is a Short. Zero API quota:
// HEAD https://www.youtube.com/shorts/<id> answers 200 for a Short and 303 -> /watch otherwise.
// Stamps videos.shorts_checked_at and sets is_short; lib/scoring/longform.ts treats unchecked
// clips as Shorts, so every check either confirms that or restores a real long-form video.
//
// Runs every 15 min via LaunchAgent com.mfm.video-scripter-verify-shorts (newest first, so a
// channel's new upload is settled before its first scoring pass). One-off backfill:
//   npx tsx scripts/verify-shorts.ts --limit 100000 --months 18 --concurrency 6
// Direct Postgres only (2026-08-31 egress rule).
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import { SHORT_MAX_SECONDS, longformSql } from '../lib/scoring/longform';
import { shortsVerdict, type ShortsVerdict } from '../lib/thumbs/shorts';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const LIMIT = Number(arg('--limit') ?? 2000);
const MONTHS = Number(arg('--months') ?? 18);
const CONCURRENCY = Number(arg('--concurrency') ?? 4);
const CHANNELS = (arg('--channels') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
// --only-flagged: re-check videos the old CDN detector marked is_short=true (it had ~10% false positives).
const ONLY_FLAGGED = process.argv.includes('--only-flagged');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const chFilter = CHANNELS.length ? 'and v.channel_id = any($3)' : '';
const rows: { id: string }[] = (await pool.query(
  `select v.id from videos v
    where v.shorts_checked_at is null
      and (${ONLY_FLAGGED ? '($1::int < 0)' : `(v.duration ~ '^PT[0-9HMS]+$' and extract(epoch from v.duration::interval) <= $1)`}
           or v.is_short = true)
      and v.published_at > now() - ($2 || ' months')::interval
      ${chFilter}
    order by v.published_at desc limit ${LIMIT}`,
  CHANNELS.length ? [SHORT_MAX_SECONDS, String(MONTHS), CHANNELS] : [SHORT_MAX_SECONDS, String(MONTHS)]
)).rows;
log(`verify-shorts: ${rows.length} unverified ${ONLY_FLAGGED ? 'CDN-flagged videos' : `clips <= ${SHORT_MAX_SECONDS}s (plus CDN-flagged)`}`);

type Verdict = ShortsVerdict;
const check = (id: string): Promise<Verdict> => shortsVerdict(id);

let shorts = 0, long = 0, gone = 0, retry = 0, done = 0;
const queue = [...rows];
async function worker() {
  while (queue.length) {
    const { id } = queue.shift()!;
    const v = await check(id);
    if (v === 'unknown') { retry++; continue; }
    if (v === 'short') shorts++; else if (v === 'long') long++; else gone++;
    // 'gone' (private/deleted) is stamped too so we stop asking; it keeps its current flag.
    await pool.query(
      v === 'gone'
        ? `update videos set shorts_checked_at = now() where id = $1`
        : `update videos set is_short = $2, shorts_checked_at = now() where id = $1`,
      v === 'gone' ? [id] : [id, v === 'short']
    );
    // The verdict flips this video's longform status, and feed_events carries that as a stored
    // column (lib/feed/query.ts filters on it), so re-stamp the video's events in the same pass.
    await pool.query(
      `update feed_events e
          set is_longform = coalesce((select ${longformSql('v')} from videos v where v.id = e.video_id), false)
        where e.video_id = $1`,
      [id]
    );
    done++;
    if (done % 500 === 0) log(`progress ${done}/${rows.length}: ${shorts} shorts, ${long} long-form, ${gone} gone`);
    await sleep(120);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
log(`done: ${done} checked — ${shorts} shorts, ${long} long-form, ${gone} gone, ${retry} to retry next run`);
await pool.end();
