// Ask YouTube whether each unverified <=180s video is a Short. Zero API quota:
// HEAD https://www.youtube.com/shorts/<id> answers 200 for a Short and 303 -> /watch otherwise.
// Stamps videos.shorts_checked_at and sets is_short; lib/scoring/longform.ts treats unchecked
// clips as Shorts, so every check either confirms that or restores a real long-form video.
//
// Runs every 15 min via LaunchAgent com.mfm.video-scripter-verify-shorts (newest first, so a
// channel's new upload is settled before its first scoring pass). One-off backfill:
//   npx tsx scripts/verify-shorts.ts --limit 5000 --months 18 --concurrency 3
// Direct Postgres only (2026-08-31 egress rule).
//
// The target query must stay index-served. Its WHERE is written to match the partial indexes in
// sql/2026-09-04-shorts-backfill-index.sql character for character — including the literal 180
// and iso8601_duration_seconds(). Before 2026-09-04 the duration test was an inline regex + cast
// that no index could cover, so each run re-read 100K-200K heap tuples from a 1.7 GB table; two
// concurrent backfills pinned the instance in IO wait and the hourly scorer timed out for six
// hours. If you change this predicate, change the indexes with it and re-check EXPLAIN.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import { SHORT_MAX_SECONDS, longformSql } from '../lib/scoring/longform';
import { shortsVerdict, type ShortsVerdict } from '../lib/thumbs/shorts';
import { startManagedJob } from '../lib/nightly/job-lifecycle';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const LIMIT = Math.min(Number(arg('--limit') ?? 2000), 20000);
const MONTHS = Number(arg('--months') ?? 18);
// Each checked video costs two UPDATEs (videos + feed_events) against a 4 GB table that the
// scorer, view tracking and rss-poll share. Three workers is the ceiling that leaves them room.
const CONCURRENCY = Math.min(Number(arg('--concurrency') ?? 3), 3);
const CHANNELS = (arg('--channels') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
// --only-flagged: re-check videos the old CDN detector marked is_short=true (it had ~10% false positives).
const ONLY_FLAGGED = process.argv.includes('--only-flagged');
const job = startManagedJob({ name: ONLY_FLAGGED ? 'verify-shorts:flagged' : 'verify-shorts:default' });
if (!job.acquired) process.exit(0);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
// Same guard the other scheduled scripts use: a query that cannot be served from an index dies
// instead of holding IO for ten minutes (scripts/score-videos.ts).
pool.on('connect', (c: pg.PoolClient) => { c.query('set statement_timeout = 300000').catch(() => {}); });
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const chFilter = CHANNELS.length ? 'and v.channel_id = any($2)' : '';
// --only-flagged -> videos_shorts_flagged_unchecked_idx; default -> videos_shorts_backfill_idx.
const targets = ONLY_FLAGGED
  ? 'v.is_short'
  : `(v.is_short or iso8601_duration_seconds(v.duration) <= ${SHORT_MAX_SECONDS})`;
const rows: { id: string }[] = (await pool.query(
  `select v.id from videos v
    where v.shorts_checked_at is null
      and ${targets}
      and v.published_at > now() - ($1 || ' months')::interval
      ${chFilter}
    order by v.published_at desc limit ${LIMIT}`,
  CHANNELS.length ? [String(MONTHS), CHANNELS] : [String(MONTHS)]
)).rows;
log(`verify-shorts: ${rows.length} unverified ${ONLY_FLAGGED ? 'CDN-flagged videos' : `clips <= ${SHORT_MAX_SECONDS}s (plus CDN-flagged)`}`);

type Verdict = ShortsVerdict;
const check = (id: string): Promise<Verdict> => shortsVerdict(id);

let shorts = 0, long = 0, gone = 0, retry = 0, done = 0;
const queue = [...rows];
async function worker() {
  while (queue.length && !job.signal.aborted) {
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
job.finish();
