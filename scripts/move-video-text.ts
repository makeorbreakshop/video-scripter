// Copy videos.description / metadata / llm_summary into video_text for videos that have no side
// row yet, in bounded windows of primary keys.
//
// Since 2026-09-26 the ingest writers insert the side row themselves (lib/ingest/video-insert.ts),
// so this nightly pass only catches what legacy writers (manual API routes) still create. It
// walks the whole key space in windows of --batch primary keys: each statement's cost is bounded
// by the window, however few rows are actually left to move — the previous `limit 2000` search
// walked the entire key space once the work was sparse and died on the statement timeout
// (57014, logs/move-video-text-launchd.err.log, 2026-09-15..26).
//
// It COPIES. Nothing is nulled here.
//
// Usage:
//   npx tsx scripts/move-video-text.ts --dry-run
//   npx tsx scripts/move-video-text.ts --batch 5000 --sleep-ms 100 --max-seconds 1200   # nightly
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { makeTimedPool } from '../lib/admin/db';
import { moveWindowSql } from '../lib/app/video-text-move';
import { LONG_RUNNING_QUERY_SQL } from '../lib/app/video-text-move';
import { recordOutcome } from '../lib/ops/job-outcomes';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const arg = (f: string, d?: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const DRY = has('--dry-run') || has('--dry');
const WINDOW = Number(arg('--batch', '5000'));
const SLEEP = Number(arg('--sleep-ms', '100'));
const MAX_WINDOWS = Number(arg('--max-windows', '0'));
const MAX_SECONDS = Number(arg('--max-seconds', '1200'));
const JOB = 'move-video-text';

const pool = makeTimedPool({ connectionString: process.env.DATABASE_URL, max: 1, timeoutMs: 60_000 });
const q = async <T = any>(sql: string, params: any[] = []): Promise<T[]> => (await pool.query(sql, params)).rows as T[];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function heavy(): Promise<string | null> {
  const rows = await q<{ n: string }>(LONG_RUNNING_QUERY_SQL);
  return Number(rows[0]?.n ?? 0) > 0 ? 'a query has been running over two minutes' : null;
}

let moved = 0, scanned = 0, windows = 0, bytes = 0, wrapped = false, stoppedFor: string | null = null;
const t0 = Date.now();
try {
  const busy = await heavy();
  if (busy && !has('--force')) {
    stoppedFor = busy;
  } else {
    console.log(`move-video-text: window ${WINDOW}, sleep ${SLEEP}ms, budget ${MAX_SECONDS}s${DRY ? ' [dry run]' : ''}`);
    let cursor = '';
    for (;;) {
      const [r] = await q<{ next_cursor: string | null; scanned: number; moved: number; bytes: string }>(
        moveWindowSql(DRY), [cursor, WINDOW]);
      if (!r || r.next_cursor == null) { wrapped = true; break; }
      cursor = r.next_cursor;
      scanned += Number(r.scanned); moved += Number(r.moved); bytes += Number(r.bytes);
      windows++;
      if (windows % 20 === 0) {
        console.log(`  ${scanned.toLocaleString()} scanned · ${moved.toLocaleString()} moved · ` +
                    `${((Date.now() - t0) / 1000).toFixed(0)}s · at '${cursor}'`);
        const b = await heavy();
        if (b && !has('--force')) { stoppedFor = b; break; }
      }
      if (MAX_WINDOWS && windows >= MAX_WINDOWS) { stoppedFor = `--max-windows ${MAX_WINDOWS}`; break; }
      if ((Date.now() - t0) / 1000 > MAX_SECONDS) { stoppedFor = `--max-seconds ${MAX_SECONDS}`; break; }
      await sleep(SLEEP);
    }
  }
  const detail = `${moved} moved of ${scanned} scanned in ${windows} window(s), ${(bytes / 1e6).toFixed(1)} MB, ` +
                 `${((Date.now() - t0) / 1000).toFixed(0)}s${wrapped ? ', full pass' : ''}${stoppedFor ? `; stopped: ${stoppedFor}` : ''}`;
  console.log(`done: ${detail}`);
  if (!DRY) {
    recordOutcome({
      job: JOB,
      status: moved > 0 ? 'progressed' : wrapped ? 'idle' : 'stood_down',
      progressed: moved,
      // A pass that stopped early cannot say how much is left; a full pass that moved nothing
      // has nothing left.
      backlog: wrapped ? 0 : null,
      detail,
    });
  }
} catch (err) {
  if (!DRY) recordOutcome({ job: JOB, status: 'failed', progressed: moved, backlog: null, detail: (err as Error).message });
  console.error(err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
