// Clear videos.<column> for rows whose video_text copy is proved byte-equal — incrementally.
//
// This is the only irreversible step in the reclaim, and since 2026-09-26 it has no global gate.
// It walks the primary key in windows (lib/app/video-text-move.ts nullWindowSql); each window
// clears the rows it can prove in the same statement and counts the ones it cannot (no side row
// yet, or a side copy that disagrees). Tomorrow's pass picks up whatever the mover has reached by
// then. The previous design waited for the whole corpus to be moved first — a queue that daily
// ingest refills — and stood down twelve nights out of twelve (lib/app/null-out-gate.ts).
//
// Columns: CLEARED_COLUMNS by default (llm_summary as of 2026-09-26). A column with direct readers
// left is refused (lib/app/video-text-access.test.ts decides), and so is any run while the
// mirror trigger exists — it would copy the NULLs into video_text.
//
// The cursor persists across runs (logs/state/null-video-text.cursor), so a pass that hits its
// time budget resumes where it stopped rather than re-walking the head of the table.
//
// Usage:
//   npx tsx scripts/null-video-text.ts --dry-run                 # plan + bounded coverage report
//   npx tsx scripts/null-video-text.ts --max-seconds 1200        # the nightly form
//   npx tsx scripts/null-video-text.ts --columns llm_summary --batch 5000 --sleep-ms 100
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import fs from 'node:fs';
import path from 'node:path';
import { makeTimedPool } from '../lib/admin/db';
import {
  nullWindowSql, MIRROR_TRIGGER_SQL, NULL_COVERAGE_SQL, MOVED_COUNT_SQL, TEXT_COLUMNS, CLEARED_COLUMNS,
  type TextColumn,
} from '../lib/app/video-text-move';
import { LONG_RUNNING_QUERY_SQL } from '../lib/app/video-text-move';
import { planNullOut, summarizeNullPass, recentIdleFullPass, type NullWindow } from '../lib/app/null-out-gate';
import { recordOutcome, readOutcomes } from '../lib/ops/job-outcomes';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const arg = (f: string, d?: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const DRY = has('--dry-run') || has('--dry');
const WINDOW = Number(arg('--batch', '5000'));
const SLEEP = Number(arg('--sleep-ms', '100'));
const MAX_WINDOWS = Number(arg('--max-windows', '0'));
const MAX_SECONDS = Number(arg('--max-seconds', '1200'));
const SAMPLE = Number(arg('--sample', '20000'));
/** Skip the walk if a full pass over the same columns came back idle within this many days. 0 = always walk. */
const IDLE_DAYS = Number(arg('--full-pass-days', '7'));
const JOB = 'null-video-text';
const CURSOR_FILE = path.join(process.cwd(), 'logs', 'state', 'null-video-text.cursor');

const COLUMNS = (arg('--columns', CLEARED_COLUMNS.join(',')) as string)
  .split(',').map((c) => c.trim()).filter(Boolean) as TextColumn[];
for (const c of COLUMNS) {
  if (!(TEXT_COLUMNS as readonly string[]).includes(c)) {
    console.error(`--columns: ${c} is not one of ${TEXT_COLUMNS.join(', ')}`);
    process.exit(2);
  }
}

const pool = makeTimedPool({ connectionString: process.env.DATABASE_URL, max: 1, timeoutMs: 60_000 });
const q = async <T = any>(sql: string, params: any[] = []): Promise<T[]> => (await pool.query(sql, params)).rows as T[];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function heavy(): Promise<string | null> {
  const rows = await q<{ n: string }>(LONG_RUNNING_QUERY_SQL);
  return Number(rows[0]?.n ?? 0) > 0 ? 'a query has been running over two minutes' : null;
}

const readCursor = () => { try { return fs.readFileSync(CURSOR_FILE, 'utf8').trim(); } catch { return ''; } };
const writeCursor = (c: string) => {
  try { fs.mkdirSync(path.dirname(CURSOR_FILE), { recursive: true }); fs.writeFileSync(CURSOR_FILE, c); }
  catch (e) { console.error(`could not persist cursor: ${(e as Error).message}`); }
};

/** Bounded report: a sample of video_text joined to videos by primary key. Never a scan. */
async function coverage() {
  const moved = Number((await q<{ n: string }>(MOVED_COUNT_SQL))[0].n);
  const c = (await q<Record<string, string>>(NULL_COVERAGE_SQL, [SAMPLE]))[0];
  const n = (k: string) => Number(c?.[k] ?? 0);
  const sampled = n('sampled');
  const pct = (v: number) => (sampled ? `${((v / sampled) * 100).toFixed(2)}%` : '—');
  console.log(`coverage: ~${moved.toLocaleString()} side rows (planner estimate); sampled ${sampled.toLocaleString()}, all three columns:`);
  console.log(`  all three byte-equal, clearable  : ${n('verified_equal').toLocaleString().padStart(10)}  ${pct(n('verified_equal'))}`);
  console.log(`  all three already clear          : ${n('already_clear').toLocaleString().padStart(10)}  ${pct(n('already_clear'))}`);
  console.log(`  DISAGREE, never touched          : ${n('disagree').toLocaleString().padStart(10)}  ${pct(n('disagree'))}`);
  if (n('disagree')) {
    console.log(`    by column: description ${n('disagree_description')}, metadata ${n('disagree_metadata')}, ` +
                `llm_summary ${n('disagree_llm_summary')}`);
  }
}

const windows: NullWindow[] = [];
let wrapped = false, stoppedFor: string | null = null;
const t0 = Date.now();
try {
  const triggers = (await q<{ tgname: string }>(MIRROR_TRIGGER_SQL)).map((t) => t.tgname);
  const plan = planNullOut({ mirrorTriggers: triggers, columns: COLUMNS });
  console.log(`null-video-text: [${COLUMNS.join(', ')}], window ${WINDOW}, budget ${MAX_SECONDS}s → ` +
              (plan.action === 'run' ? 'run' : `REFUSE: ${plan.reason}`) + (DRY ? ' [dry run]' : ''));

  if (DRY) {
    await coverage();
  } else if (plan.action === 'refuse') {
    // A refusal is not "nothing to do": it is work held back by a precondition, which is exactly
    // what the silent-no-op detector must see.
    recordOutcome({ job: JOB, status: 'stood_down', progressed: 0, backlog: null, detail: plan.reason,
                    meta: { columns: COLUMNS, fullPass: false } });
    process.exitCode = 2;
  } else {
    const busy = await heavy();
    const idle = IDLE_DAYS > 0 && !has('--force') ? recentIdleFullPass(readOutcomes(), COLUMNS, new Date(), IDLE_DAYS) : undefined;
    if (idle) {
      // Not a stand-down: a full pass proved there was nothing to do, recently enough.
      const detail = `[${COLUMNS.join(',')}] skipped: full pass at ${idle.at} found nothing held (next full pass within ${IDLE_DAYS} days of it)`;
      console.log(detail);
      recordOutcome({ job: JOB, status: 'idle', progressed: 0, backlog: 0, detail,
                      meta: { columns: COLUMNS, fullPass: false, skipped: true } });
    } else if (busy && !has('--force')) {
      recordOutcome({ job: JOB, status: 'stood_down', progressed: 0, backlog: null, detail: busy,
                      meta: { columns: COLUMNS, fullPass: false } });
    } else {
      const sql = nullWindowSql(plan.columns);
      let cursor = readCursor();
      const startedAt = cursor;
      if (cursor) console.log(`resuming at '${cursor}'`);
      for (;;) {
        const [r] = await q<{ next_cursor: string | null; scanned: number; cleared: number; disagree: number; unmoved_holding: number }>(
          sql, [cursor, WINDOW]);
        if (!r || r.next_cursor == null) { wrapped = true; cursor = ''; break; }
        cursor = r.next_cursor;
        windows.push({ nextCursor: r.next_cursor, scanned: Number(r.scanned), cleared: Number(r.cleared),
                       disagree: Number(r.disagree), unmovedHolding: Number(r.unmoved_holding) });
        writeCursor(cursor);
        if (windows.length % 20 === 0) {
          const s = summarizeNullPass(windows, { wrapped: false });
          console.log(`  ${s.scanned.toLocaleString()} scanned · ${s.progressed.toLocaleString()} cleared · ` +
                      `${s.backlog.toLocaleString()} held back · ${((Date.now() - t0) / 1000).toFixed(0)}s · at '${cursor}'`);
          const b = await heavy();
          if (b && !has('--force')) { stoppedFor = b; break; }
        }
        if (MAX_WINDOWS && windows.length >= MAX_WINDOWS) { stoppedFor = `--max-windows ${MAX_WINDOWS}`; break; }
        if ((Date.now() - t0) / 1000 > MAX_SECONDS) { stoppedFor = `--max-seconds ${MAX_SECONDS}`; break; }
        await sleep(SLEEP);
      }
      writeCursor(cursor);
      const s = summarizeNullPass(windows, { wrapped });
      const detail = `[${COLUMNS.join(',')}] ${s.progressed} cleared, ${s.unmovedHolding} not yet moved, ` +
                     `${s.disagree} disagree; ${s.scanned} scanned in ${windows.length} window(s), ` +
                     `${((Date.now() - t0) / 1000).toFixed(0)}s${wrapped ? ', reached the end' : ''}` +
                     `${stoppedFor ? `; stopped: ${stoppedFor}` : ''}`;
      for (const w of s.warnings) console.warn(`WARNING: ${w}`);
      console.log(`done: ${detail}`);
      console.log('NOTE: the heap does not shrink on its own; see docs/runbooks/2026-09-26-disk-growth.md.');
      recordOutcome({ job: JOB, status: s.status, progressed: s.progressed, backlog: s.backlog, detail,
                      meta: { columns: COLUMNS, fullPass: wrapped && startedAt === '' } });
    }
  }
} catch (err) {
  if (!DRY) {
    const done = summarizeNullPass(windows, { wrapped: false });
    recordOutcome({ job: JOB, status: 'failed', progressed: done.progressed, backlog: null, detail: (err as Error).message });
  }
  console.error(err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
