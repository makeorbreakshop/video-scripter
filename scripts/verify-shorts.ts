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
import { SHORT_MAX_SECONDS } from '../lib/scoring/longform';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const LIMIT = Number(arg('--limit') ?? 2000);
const MONTHS = Number(arg('--months') ?? 18);
const CONCURRENCY = Number(arg('--concurrency') ?? 4);
const CHANNELS = (arg('--channels') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const chFilter = CHANNELS.length ? 'and v.channel_id = any($3)' : '';
const rows: { id: string }[] = (await pool.query(
  `select v.id from videos v
    where v.shorts_checked_at is null
      and v.duration ~ '^PT[0-9HMS]+$'
      and extract(epoch from v.duration::interval) <= $1
      and v.published_at > now() - ($2 || ' months')::interval
      ${chFilter}
    order by v.published_at desc limit ${LIMIT}`,
  CHANNELS.length ? [SHORT_MAX_SECONDS, String(MONTHS), CHANNELS] : [SHORT_MAX_SECONDS, String(MONTHS)]
)).rows;
log(`verify-shorts: ${rows.length} unverified clips <= ${SHORT_MAX_SECONDS}s`);

type Verdict = 'short' | 'long' | 'gone' | 'retry';
async function check(id: string): Promise<Verdict> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`https://www.youtube.com/shorts/${id}`, { method: 'HEAD', redirect: 'manual', headers: { 'user-agent': UA } });
      if (r.status === 200) return 'short';
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get('location') ?? '';
        return /\/watch\?v=/.test(loc) ? 'long' : 'gone';
      }
      if (r.status === 404 || r.status === 410) return 'gone';
      if (r.status === 429 || r.status >= 500) { await sleep(2000 * (attempt + 1)); continue; }
      return 'gone';
    } catch { await sleep(1000 * (attempt + 1)); }
  }
  return 'retry';
}

let shorts = 0, long = 0, gone = 0, retry = 0, done = 0;
const queue = [...rows];
async function worker() {
  while (queue.length) {
    const { id } = queue.shift()!;
    const v = await check(id);
    if (v === 'retry') { retry++; continue; }
    if (v === 'short') shorts++; else if (v === 'long') long++; else gone++;
    // 'gone' (private/deleted) is stamped too so we stop asking; it keeps its current flag.
    await pool.query(
      v === 'gone'
        ? `update videos set shorts_checked_at = now() where id = $1`
        : `update videos set is_short = $2, shorts_checked_at = now() where id = $1`,
      v === 'gone' ? [id] : [id, v === 'short']
    );
    done++;
    if (done % 500 === 0) log(`progress ${done}/${rows.length}: ${shorts} shorts, ${long} long-form, ${gone} gone`);
    await sleep(120);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
log(`done: ${done} checked — ${shorts} shorts, ${long} long-form, ${gone} gone, ${retry} to retry next run`);
await pool.end();
