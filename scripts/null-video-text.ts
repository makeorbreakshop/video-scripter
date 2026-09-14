// Clear videos.description / metadata / llm_summary for rows already proved safe in video_text.
//
// scripts/move-video-text.ts COPIES. Copying reclaims nothing — until the originals are NULL,
// `videos` still holds every byte, and the table stays at 3,984 MB against a 512 MB buffer pool.
// This is the step that shrinks it, and the only irreversible one in the whole sequence.
//
// THE RULE: a row is cleared only when video_text holds a byte-for-byte identical copy of all
// three columns, checked by the same statement that does the clearing (lib/app/video-text-move.ts
// nullBatchSql). A row the mover has not reached, or whose copies disagree, is never touched.
//
// PRECONDITION, AND IT IS NOT MET YET (2026-09-14): thirty live call sites still read these
// columns straight off `videos` instead of through lib/app/video-text.ts. The moment they read
// a NULL they silently serve empty text. lib/app/video-text-access.test.ts enumerates them and
// fails if the list grows. Until that list is empty this script refuses to run without --force,
// and it is NOT scheduled in launchd.
//
// Usage:
//   npx tsx scripts/null-video-text.ts --dry-run
//   npx tsx scripts/null-video-text.ts --verify
//   npx tsx scripts/null-video-text.ts --batch 2000 --sleep-ms 250
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { makeTimedPool } from '../lib/admin/db';
import {
  nullBatchSql, NULL_COUNT_REMAINING_SQL, NULL_VERIFY_SQL,
} from '../lib/app/video-text-move';
import { MOVE_COUNT_REMAINING_SQL } from '../lib/app/video-text-move';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const arg = (f: string, d?: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const DRY = has('--dry-run') || has('--dry');
const BATCH = Number(arg('--batch', '2000'));
const SLEEP = Number(arg('--sleep-ms', '250'));
const MAX_BATCHES = Number(arg('--max-batches', '0'));

const pool = makeTimedPool({ connectionString: process.env.DATABASE_URL, max: 2, timeoutMs: 120_000 });
const q = async <T = any>(sql: string, params: any[] = []): Promise<T[]> =>
  (await pool.query(sql, params)).rows as T[];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Same back-off preflight the mover uses: never add load to an instance that already has some. */
async function heavy(): Promise<string | null> {
  const rows = await q<{ n: string }>(
    `select count(*)::text as n from pg_stat_activity
      where state = 'active' and now() - query_start > interval '2 minutes'
        and query not ilike '%pg_stat_activity%'`);
  return Number(rows[0]?.n ?? 0) > 0 ? 'a query has been running over two minutes' : null;
}

// ---- the two gates --------------------------------------------------------------------

const disagreements = await q<{ id: string }>(NULL_VERIFY_SQL, [5]);
if (disagreements.length) {
  console.error(
    `REFUSING TO RUN: ${disagreements.length}+ row(s) disagree between videos and video_text ` +
    `(${disagreements.map((r) => r.id).join(', ')}). The copy is not trustworthy, so nothing ` +
    `may be cleared. Re-run scripts/move-video-text.ts and investigate.`);
  await pool.end();
  process.exit(2);
}

if (has('--verify')) {
  const moved = Number((await q<{ n: string }>(MOVE_COUNT_REMAINING_SQL))[0].n);
  const left = Number((await q<{ n: string }>(NULL_COUNT_REMAINING_SQL))[0].n);
  console.log(`verify: 0 disagreements; ${moved.toLocaleString()} video(s) not yet moved; ` +
              `${left.toLocaleString()} moved row(s) still holding their originals`);
  await pool.end();
  process.exit(0);
}

const unmoved = Number((await q<{ n: string }>(MOVE_COUNT_REMAINING_SQL))[0].n);
if (unmoved > 0 && !has('--force')) {
  // Not fatal to correctness — the join simply would not select those rows — but running a
  // destructive pass over a partial copy means running it again later, and the point of the
  // gate is that this script is only ever launched against a finished move.
  console.error(
    `REFUSING TO RUN: ${unmoved.toLocaleString()} video(s) are not in video_text yet. ` +
    `Let scripts/move-video-text.ts finish first, or pass --force to clear what is ready.`);
  await pool.end();
  process.exit(2);
}

const stop = await heavy();
if (stop && !has('--force')) {
  console.error(`refusing to run: ${stop}`);
  await pool.end();
  process.exit(2);
}

// ---- the walk -------------------------------------------------------------------------

const before = Number((await q<{ n: string }>(NULL_COUNT_REMAINING_SQL))[0].n);
console.log(`null-video-text: batch ${BATCH}, sleep ${SLEEP}ms${DRY ? ' [dry run]' : ''}, ` +
            `${before.toLocaleString()} verified row(s) to clear`);

if (DRY) {
  console.log(`dry run: would clear ${before.toLocaleString()} row(s) in ` +
              `${Math.ceil(before / BATCH)} batch(es); nothing written`);
  await pool.end();
  process.exit(0);
}

let cleared = 0, batches = 0;
let cursor = '';
const t0 = Date.now();
for (;;) {
  const rows = await q<{ id: string }>(nullBatchSql(), [cursor, BATCH]);
  if (!rows.length) { console.log('nothing left to clear'); break; }
  // The statement returns the ids it actually updated, in key order, so the cursor advances on
  // what happened rather than on what was asked for.
  cursor = rows[rows.length - 1].id;
  cleared += rows.length;
  batches++;
  if (batches % 5 === 0) {
    const busy = await heavy();
    if (busy && !has('--force')) {
      console.error(`stopping early: ${busy} (${cleared} cleared — rerun to resume)`);
      break;
    }
    console.log(`  ${cleared.toLocaleString()} cleared · ${((Date.now() - t0) / 1000).toFixed(0)}s · at '${cursor}'`);
  }
  if (MAX_BATCHES && batches >= MAX_BATCHES) { console.log(`--max-batches ${MAX_BATCHES} reached`); break; }
  await sleep(SLEEP);
}

const left = Number((await q<{ n: string }>(NULL_COUNT_REMAINING_SQL))[0].n);
console.log(`done: ${cleared.toLocaleString()} row(s) cleared, ${((Date.now() - t0) / 1000).toFixed(0)}s, ` +
            `${left.toLocaleString()} still holding their originals`);
console.log('NOTE: the heap does not shrink on its own. See docs/runbooks/2026-09-14-videos-reclaim.md ' +
            '— pg_repack is what returns the space to the filesystem.');
await pool.end();
