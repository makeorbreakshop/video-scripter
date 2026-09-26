// The scheduled entry point for the null-out (com.mfm.video-scripter-null-video-text, 06:00 ET).
//
// Until 2026-09-26 this was a gate: poll until EVERY video had a video_text row, give up at
// 05:48, exit 0. It ran at 06:00, after its own deadline, against a backlog daily ingest
// refills — so it stood down 12 nights out of 12 and never cleared a byte
// (lib/app/null-out-gate.ts has the numbers). A global "backlog == 0" condition on a
// continuously-fed queue never opens.
//
// Now it simply runs one bounded, resumable, per-row-verified pass of scripts/null-video-text.ts
// for the cleared columns and exits with its status. There is no waiting and no deadline: rows
// the mover has not reached yet are cleared on a later night. The outcome goes to the job ledger
// (logs/job-outcomes.jsonl), and scripts/storage-guard.ts alerts if the pass keeps doing nothing
// while text is still held.
//
// It no longer drops idx_videos_id_llm_summary itself. A scheduled job should not run DDL, and
// the right order is the reverse of the old one anyway: drop the llm_summary indexes FIRST, so
// the null-out's UPDATEs can be HOT instead of writing a new entry into all 45 indexes of
// `videos` per row. See docs/runbooks/2026-09-26-disk-growth.md, step 2.
//
// `--deadline` is accepted and ignored so the installed plist keeps working unchanged.
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const i = args.indexOf('--deadline');
if (i >= 0) {
  console.log(`[${new Date().toISOString()}] --deadline ${args[i + 1]} ignored: the null-out no longer waits for the mover`);
  args.splice(i, 2);
}
const passthrough = args.length ? args : ['--max-seconds', '1200', '--batch', '5000', '--sleep-ms', '100'];
const res = spawnSync('npx', ['tsx', 'scripts/null-video-text.ts', ...passthrough], { stdio: 'inherit' });
process.exit(res.status ?? 1);
