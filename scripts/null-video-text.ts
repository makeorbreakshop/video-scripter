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
  nullBatchSql, nullCountRemainingSql, nullVerifySql,
  MIRROR_TRIGGER_SQL, NULL_COVERAGE_SQL, MOVED_COUNT_SQL, TEXT_COLUMNS, type TextColumn,
} from '../lib/app/video-text-move';
import { MOVE_COUNT_REMAINING_SQL } from '../lib/app/video-text-move';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const arg = (f: string, d?: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const DRY = has('--dry-run') || has('--dry');
const BATCH = Number(arg('--batch', '2000'));
const SLEEP = Number(arg('--sleep-ms', '250'));
const MAX_BATCHES = Number(arg('--max-batches', '0'));
const SAMPLE = Number(arg('--sample', '50000'));

/**
 * Which columns to clear. Defaults to llm_summary alone, and that default is the whole point.
 *
 * As of 2026-09-14 the sweep in lib/app/video-text-sweep.ts finds 0 direct readers of
 * llm_summary, 10 of description and 18 of metadata — the last including lib/ingest/first-sample.ts,
 * which WRITES metadata on every nightly ingest. Clearing description or metadata now would
 * break live searches (`.not('description','ilike','%#shorts%')` matches nothing once the
 * column is NULL) and would be undone by the next import anyway. Pass --columns explicitly, and
 * only once lib/app/video-text-access.test.ts says the column is cleared.
 */
const COLUMNS = (arg('--columns', 'llm_summary') as string)
  .split(',').map((c) => c.trim()).filter(Boolean) as TextColumn[];
for (const c of COLUMNS) {
  if (!(TEXT_COLUMNS as readonly string[]).includes(c)) {
    console.error(`--columns: ${c} is not one of ${TEXT_COLUMNS.join(', ')}`);
    process.exit(2);
  }
}
const NULL_VERIFY_SQL = nullVerifySql(COLUMNS);
const NULL_COUNT_REMAINING_SQL = nullCountRemainingSql(COLUMNS);

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

// ---- gate 0: the mirror trigger ---------------------------------------------------------
//
// THIS IS THE ONE THAT WOULD HAVE LOST THE DATA. video_text_mirror_upd fires AFTER UPDATE ON
// videos WHEN one of the three columns changed, and copies the new values into video_text.
// The statement below is `update videos set description = null, metadata = null,
// llm_summary = null`. The trigger would have fired on every batch and written NULL over the
// side copy — deleting the only remaining copy of ~2 GB of text, while every other check in
// this script kept passing, because afterwards the two copies do agree: both NULL.
//
// Drop it first: psql -f sql/2026-09-14-retire-video-text-mirror.sql
// Rollback:      psql -f sql/rollback/2026-09-14-retire-video-text-mirror.sql
const triggers = await q<{ tgname: string }>(MIRROR_TRIGGER_SQL);
// --dry-run and --verify write nothing, so they are allowed to report on a database that is
// not ready yet — that is what they are for. They still say so, at the top, unmissably.
if (triggers.length && (DRY || has('--verify'))) {
  console.error(
    `WARNING: the mirror trigger is still installed (${triggers.map((t) => t.tgname).join(', ')}). ` +
    `A real run is blocked until sql/2026-09-14-retire-video-text-mirror.sql is applied.`);
} else if (triggers.length && !has('--force')) {
  console.error(
    `REFUSING TO RUN: the mirror trigger is still installed on videos ` +
    `(${triggers.map((t) => t.tgname).join(', ')}). It fires on exactly the UPDATE this script ` +
    `issues and would overwrite video_text with NULLs — destroying the only copy of the text ` +
    `rather than freeing it. Apply sql/2026-09-14-retire-video-text-mirror.sql first.`);
  await pool.end();
  process.exit(2);
} else if (triggers.length) {
  // --force overrides the other gates on purpose. It does not override this one: there is no
  // scenario in which running underneath the mirror trigger is the intended outcome.
  console.error('--force given with the mirror trigger installed. This WOULD destroy video_text. No.');
  await pool.end();
  process.exit(2);
}

// ---- the two gates --------------------------------------------------------------------

const REPORT_ONLY = DRY || has('--verify');

const disagreements = await q<{ id: string }>(NULL_VERIFY_SQL, [5]);
if (disagreements.length && REPORT_ONLY) {
  console.error(`WARNING: ${disagreements.length}+ row(s) disagree between videos and video_text. ` +
                `A real run is blocked. See the per-column breakdown below.`);
} else if (disagreements.length) {
  console.error(
    `REFUSING TO RUN: ${disagreements.length}+ row(s) disagree between videos and video_text ` +
    `(${disagreements.map((r) => r.id).join(', ')}). The copy is not trustworthy, so nothing ` +
    `may be cleared. Re-run scripts/move-video-text.ts and investigate.`);
  await pool.end();
  process.exit(2);
}

/**
 * The coverage report. "It would clear N rows" is not enough to sign off an irreversible pass:
 * what matters is how much of the corpus is PROVED safe and what the rest is blocked on.
 */
async function coverage() {
  const moved = Number((await q<{ n: string }>(MOVED_COUNT_SQL))[0].n);
  const unmoved = Number((await q<{ n: string }>(MOVE_COUNT_REMAINING_SQL))[0].n);
  const c = (await q<Record<string, string>>(NULL_COVERAGE_SQL, [SAMPLE]))[0];
  const n = (k: string) => Number(c[k] ?? 0);
  const sampled = n('sampled');
  const pct = (v: number) => (sampled ? `${((v / sampled) * 100).toFixed(2)}%` : '—');
  console.log(`coverage: ${moved.toLocaleString()} video(s) moved, ` +
              `${unmoved.toLocaleString()} not yet moved ` +
              `(${(moved / (moved + unmoved) * 100).toFixed(1)}% of the corpus is in video_text)`);
  // Deliberately reported over all three columns, not just the ones being cleared: this is the
  // health of the whole move, and it is what says whether the OTHER columns will be clearable
  // later. The count of rows this run would actually touch is printed separately, above.
  console.log(`sampled ${sampled.toLocaleString()} of them (--sample ${SAMPLE}), all three columns:`);
  console.log(`  all three byte-equal, safe       : ${n('verified_equal').toLocaleString().padStart(10)}  ${pct(n('verified_equal'))}`);
  console.log(`  all three already clear          : ${n('already_clear').toLocaleString().padStart(10)}  ${pct(n('already_clear'))}`);
  console.log(`  DISAGREE, would never be touched : ${n('disagree').toLocaleString().padStart(10)}  ${pct(n('disagree'))}`);
  if (n('disagree')) {
    console.log(`    by column: description ${n('disagree_description').toLocaleString()}, ` +
                `metadata ${n('disagree_metadata').toLocaleString()}, ` +
                `llm_summary ${n('disagree_llm_summary').toLocaleString()}`);
    console.log('    a disagreement means `videos` holds text the side copy does not. Investigate ' +
                'before clearing anything: re-run scripts/move-video-text.ts, which overwrites ' +
                'the side copy from the original.');
  }
  return c;
}

if (has('--verify')) {
  const moved = Number((await q<{ n: string }>(MOVE_COUNT_REMAINING_SQL))[0].n);
  const left = Number((await q<{ n: string }>(NULL_COUNT_REMAINING_SQL))[0].n);
  console.log(`verify: 0 disagreements; ${moved.toLocaleString()} video(s) not yet moved; ` +
              `${left.toLocaleString()} moved row(s) still holding their originals`);
  await coverage();
  await pool.end();
  process.exit(0);
}

const unmoved = Number((await q<{ n: string }>(MOVE_COUNT_REMAINING_SQL))[0].n);
if (unmoved > 0 && REPORT_ONLY) {
  console.error(`WARNING: ${unmoved.toLocaleString()} video(s) are not in video_text yet; a real ` +
                `run is blocked until scripts/move-video-text.ts finishes.`);
} else if (unmoved > 0 && !has('--force')) {
  // Not fatal to correctness — the join simply would not select those rows — but running a
  // destructive pass over a partial copy means running it again later, and the point of the
  // gate is that this script is only ever launched against a finished move.
  console.error(
    `REFUSING TO RUN: ${unmoved.toLocaleString()} video(s) are not in video_text yet. ` +
    `Let scripts/move-video-text.ts finish first, or pass --force to clear what is ready.`);
  await pool.end();
  process.exit(2);
}

const stop = REPORT_ONLY ? null : await heavy();
if (stop && !has('--force')) {
  console.error(`refusing to run: ${stop}`);
  await pool.end();
  process.exit(2);
}

// ---- the walk -------------------------------------------------------------------------

const before = Number((await q<{ n: string }>(NULL_COUNT_REMAINING_SQL))[0].n);
console.log(`null-video-text: clearing [${COLUMNS.join(', ')}], batch ${BATCH}, ` +
            `sleep ${SLEEP}ms${DRY ? ' [dry run]' : ''}, ` +
            `${before.toLocaleString()} verified row(s) to clear`);

if (DRY) {
  console.log(`dry run: would clear ${before.toLocaleString()} row(s) in ` +
              `${Math.ceil(before / BATCH)} batch(es); nothing written`);
  await coverage();
  await pool.end();
  process.exit(0);
}

let cleared = 0, batches = 0;
let cursor = '';
const t0 = Date.now();
for (;;) {
  const rows = await q<{ id: string }>(nullBatchSql(COLUMNS), [cursor, BATCH]);
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
