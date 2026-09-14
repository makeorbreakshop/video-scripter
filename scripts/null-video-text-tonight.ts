// The scheduled entry point for the llm_summary null-out. Waits for the mover, or stands down.
//
// scripts/null-video-text.ts is the worker and owns every safety gate. This is the wrapper that
// decides whether tonight is the night, and it exists because the 06:00 slot sits twelve
// minutes behind the mover's expected 05:48 finish — a coincidence, not a margin. The mover
// stops itself whenever anything has been running in Postgres for over two minutes, and both
// the 04:15 fit and the 05:05 packaging counts can overrun into its window.
//
// So: poll for the move to finish, up to --deadline (05:48 ET). If it finishes, run the
// null-out and then the index drop. If it does not, exit 0 without touching anything and let
// the same job try again tomorrow. Standing down is the correct outcome and must not page.
//
// Usage:
//   npx tsx scripts/null-video-text-tonight.ts                    # the scheduled form
//   npx tsx scripts/null-video-text-tonight.ts --deadline 06:10   # give it more room
//   npx tsx scripts/null-video-text-tonight.ts --dry-run          # decide and report, do nothing
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { spawnSync } from 'node:child_process';
import { makeTimedPool } from '../lib/admin/db';
import { MOVE_COUNT_REMAINING_SQL, MIRROR_TRIGGER_SQL } from '../lib/app/video-text-move';
import { nullOutDecision } from '../lib/app/null-out-gate';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const arg = (f: string, d: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const DEADLINE = arg('--deadline', '05:48');
const POLL_MS = Number(arg('--poll-ms', '60000'));
const DRY = has('--dry-run');

const pool = makeTimedPool({ connectionString: process.env.DATABASE_URL, max: 1, timeoutMs: 120_000 });
const q = async <T = any>(sql: string, p: any[] = []): Promise<T[]> => (await pool.query(sql, p)).rows as T[];
const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run a child and stream its output; returns its exit code. */
function run(cmd: string, argv: string[]): number {
  log(`$ ${cmd} ${argv.join(' ')}`);
  if (DRY) { log('  [dry run] not executed'); return 0; }
  return spawnSync(cmd, argv, { stdio: 'inherit' }).status ?? 1;
}

// The mirror trigger would turn the null-out into a delete of video_text. scripts/null-video-text.ts
// refuses on it too; checking here as well means the job stands down at 06:00 rather than
// exiting non-zero and looking like a real failure.
const triggers = await q<{ tgname: string }>(MIRROR_TRIGGER_SQL);
if (triggers.length) {
  log(`standing down: the mirror trigger is still installed (${triggers.map((t) => t.tgname).join(', ')}). ` +
      `Apply sql/2026-09-14-retire-video-text-mirror.sql, then this job can run.`);
  await pool.end();
  process.exit(0);
}

for (;;) {
  const unmoved = Number((await q<{ n: string }>(MOVE_COUNT_REMAINING_SQL))[0].n);
  const decision = nullOutDecision({ now: new Date(), unmoved, deadline: DEADLINE });
  log(`${unmoved.toLocaleString()} video(s) not yet moved → ${decision}`);

  if (decision === 'skip') {
    log(`standing down: the move did not finish by ${DEADLINE} ET. Nothing was changed; this ` +
        `job will try again at its next scheduled run. Not a failure.`);
    await pool.end();
    process.exit(0);
  }
  if (decision === 'run') break;
  await sleep(POLL_MS);
}

await pool.end();

// The null-out first, then the index — in that order and in the same step. While llm_summary is
// still populated, dropping idx_videos_id_llm_summary first would send any straggler query to a
// sequential scan of a 1,734 MB heap. Afterwards the index's second column is NULL for every
// row and it is a wider copy of videos_pkey.
const code = run('npx', ['tsx', 'scripts/null-video-text.ts', '--columns', 'llm_summary',
                         '--batch', '2000', '--sleep-ms', '250']);
if (code !== 0) {
  log(`null-video-text exited ${code}; NOT dropping idx_videos_id_llm_summary. The index is ` +
      `what makes the remaining llm_summary queries cheap, so it stays while the column does.`);
  process.exit(code);
}

// DROP INDEX CONCURRENTLY cannot run inside a transaction block, so psql -f, not a wrapped call.
const idx = run('psql', ['-v', 'ON_ERROR_STOP=1', process.env.DATABASE_SESSION_URL ?? process.env.DATABASE_URL!,
                         '-f', 'sql/2026-09-14-drop-idx-videos-id-llm-summary.sql']);
if (idx !== 0) {
  log(`the index drop exited ${idx}. The null-out itself succeeded and is not affected; ` +
      `rerun the .sql by hand. Rollback: sql/rollback/2026-09-14-drop-idx-videos-id-llm-summary.sql`);
  process.exit(idx);
}
log('done: llm_summary cleared and idx_videos_id_llm_summary dropped. The heap does not shrink ' +
    'on its own — see docs/runbooks/2026-09-14-videos-reclaim.md for the pg_repack step.');
