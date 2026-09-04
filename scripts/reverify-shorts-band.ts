// One-off repair for the 2026-09-03/04 Shorts backfill.
//
// Those runs read every HTTP 200 from /shorts/<id> as 'short' (lib/thumbs/shorts.ts explains what
// that turned out to be). Measured 2026-09-04: the 61-180 s band stamped since 09-03 holds 67,780
// rows; a random 60 of the whole band re-checked 60/60 correct, but a random 60 from the
// 2026-09-04 00:40-05:30Z tail of the `--only-flagged` sweep came back 13/60 long-form. So the
// damage is concentrated in a window, and this script re-asks YouTube with the marker-checked
// verdict and repairs what it finds.
//
// Writes: 'short'/'long' -> is_short rewritten, shorts_checked_at = now(), feed_events re-stamped.
//         'unknown'      -> shorts_checked_at set NULL so scripts/verify-shorts.ts retries it.
//                           is_short is left alone; longformSql treats an unstamped row as a Short.
//   npx tsx scripts/reverify-shorts-band.ts --dry --limit 2000
//   npx tsx scripts/reverify-shorts-band.ts --limit 2000 --max-seconds 3600
// Direct Postgres only (2026-08-31 egress rule).
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import { longformSql } from '../lib/scoring/longform';
import { shortsVerdict, type ShortsVerdict } from '../lib/thumbs/shorts';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const DRY = process.argv.includes('--dry');
const LIMIT = Math.min(Number(arg('--limit') ?? 500), 200000);
const MAX_SECONDS = Number(arg('--max-seconds') ?? 3600);
const SINCE = arg('--since') ?? '2026-09-03';
const UNTIL = arg('--until') ?? null;
const BATCH = 500;
// Two workers at 250 ms spacing ~= 8 checks/s. Slow on purpose: the sweep that caused this bug ran
// three concurrent workers plus a second backfill, and that load is the leading suspect for the
// soft 200s. Do not raise it.
const CONCURRENCY = 2;
const SPACING_MS = 250;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
pool.on('connect', (c: pg.PoolClient) => { c.query('set statement_timeout = 60000').catch(() => {}); });
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const started = Date.now();
const outOfTime = () => (Date.now() - started) / 1000 >= MAX_SECONDS;

const where = `v.is_short
      and v.shorts_checked_at >= $1::timestamptz
      ${UNTIL ? 'and v.shorts_checked_at < $2::timestamptz' : ''}
      and iso8601_duration_seconds(v.duration) between 61 and 180`;
const params = UNTIL ? [SINCE, UNTIL] : [SINCE];

const total = Number((await pool.query(`select count(*) n from videos v where ${where}`, params)).rows[0].n);
log(`target: ${total} rows in the 61-180 s band stamped is_short since ${SINCE}${UNTIL ? ` and before ${UNTIL}` : ''}; taking ${Math.min(LIMIT, total)}${DRY ? ' (DRY RUN — no writes)' : ''}`);

// Newest stamp first: the suspect tail of the sweep is at that end.
const rows: { id: string; secs: number }[] = (await pool.query(
  `select v.id, iso8601_duration_seconds(v.duration) secs from videos v
    where ${where} order by v.shorts_checked_at desc limit ${LIMIT}`, params)).rows;

let short = 0, long = 0, unknown = 0, gone = 0, done = 0;
async function repair(id: string, v: ShortsVerdict) {
  if (DRY) return;
  if (v === 'short' || v === 'long') {
    await pool.query(`update videos set is_short = $2, shorts_checked_at = now() where id = $1`, [id, v === 'short']);
    await pool.query(
      `update feed_events e
          set is_longform = coalesce((select ${longformSql('v')} from videos v where v.id = e.video_id), false)
        where e.video_id = $1`, [id]);
  } else {
    // 'unknown' and 'gone': un-stamp so the routine verifier asks again. Never freeze a guess.
    await pool.query(`update videos set shorts_checked_at = null where id = $1`, [id]);
  }
}

for (let off = 0; off < rows.length; off += BATCH) {
  if (outOfTime()) { log(`--max-seconds ${MAX_SECONDS} reached; stopping cleanly`); break; }
  const batch = rows.slice(off, off + BATCH);
  const queue = [...batch];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      if (outOfTime()) return;
      const { id } = queue.shift()!;
      const v = await shortsVerdict(id);
      if (v === 'short') short++; else if (v === 'long') long++; else if (v === 'gone') gone++; else unknown++;
      await repair(id, v);
      done++;
      await sleep(SPACING_MS);
    }
  }));
  log(`progress ${done}/${rows.length}: ${long} flipped short->long, ${short} confirmed short, ${unknown} unknown, ${gone} gone`);
}
log(`done${DRY ? ' (DRY)' : ''}: ${done} re-checked — ${long} short->long, ${short} still short, ${unknown} unknown (un-stamped), ${gone} gone (un-stamped)`);
await pool.end();
