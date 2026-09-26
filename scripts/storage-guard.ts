// Daily storage guard: snapshot relation sizes, check the storage contract, project the disk,
// and catch scheduled jobs that have gone silent. Alerts through the paths already in use:
// a macOS notification (as scripts/check-supabase-egress.py does) and a Pulse operations
// receipt (~/.local/bin/report-pulse-operation), so the guard's own liveness is visible too.
//
// Cost, per run: one catalog statement (≤ 300 rows × ~150 B), one pg_database_size, and the
// project's Prometheus metrics text (~230 KB) for the /data volume. No table is scanned.
//
// Usage:
//   npx tsx scripts/storage-guard.ts             # the daily form (com.mfm.video-scripter-storage-guard)
//   npx tsx scripts/storage-guard.ts --no-alert  # report only
//   npx tsx scripts/storage-guard.ts --no-alert --root ../..   # judge another checkout's logs
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeTimedPool } from '../lib/admin/db';
import { CATALOG_SIZES_SQL, rowToRelation, type StorageSnapshot } from '../lib/ops/storage-contract';
import { buildGuardReport } from '../lib/ops/storage-guard';
import { fetchDiskMetrics } from '../lib/ops/supabase-metrics';
import { appendJsonLine, readJsonLines, readOutcomes, recordOutcome } from '../lib/ops/job-outcomes';
import { SCHEDULED_JOBS, EXTERNAL_HEARTBEATS, heartbeatsFor } from '../lib/ops/scheduled-jobs';

const NO_ALERT = process.argv.includes('--no-alert');
/** Where the job logs and the outcome ledger live (the production checkout). Defaults to cwd. */
const ROOT = (() => { const i = process.argv.indexOf('--root'); return i >= 0 ? path.resolve(process.argv[i + 1]) : process.cwd(); })();
const SNAPSHOTS = path.join(process.cwd(), 'logs', 'storage-snapshots.jsonl');
const JOB = 'storage-guard';

function notify(title: string, msg: string) {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').slice(0, 240);
  spawnSync('osascript', ['-e', `display notification "${esc(msg)}" with title "${esc(title)}" sound name "Basso"`]);
}

/** A Pulse operations receipt, when the reporter and its token are present. Best effort. */
function pulse(status: 'pass' | 'warn' | 'fail', summary: string) {
  const reporter = path.join(os.homedir(), '.local', 'bin', 'report-pulse-operation');
  if (!fs.existsSync(reporter)) return;
  const tokenFile = process.env.PULSE_OPERATIONS_TOKEN_FILE;
  if (!tokenFile && !process.env.PULSE_OPERATIONS_TOKEN) return;
  const r = spawnSync(reporter, ['report', '--job-id', 'studio-video-scripter-storage-guard',
    '--name', 'Video Scripter storage guard', '--kind', 'launchd', '--schedule', 'daily 07:15 ET',
    '--status', status, '--summary', summary.slice(0, 900), '--project-ref', 'video-scripter',
    '--evidence-path', SNAPSHOTS], { encoding: 'utf8' });
  if (r.status !== 0) console.error(`pulse receipt: exit ${r.status} ${r.stdout ?? ''}${r.stderr ?? ''}`.trim());
}

const pool = makeTimedPool({ connectionString: process.env.DATABASE_URL, max: 1, timeoutMs: 20_000 });
try {
  const relations = (await pool.query(CATALOG_SIZES_SQL)).rows.map(rowToRelation);
  const dbBytes = Number((await pool.query(`select pg_database_size(current_database())::float8 as b`)).rows[0].b);
  const snapshot: StorageSnapshot = { at: new Date().toISOString(), dbBytes, disk: await fetchDiskMetrics(), relations };
  appendJsonLine(SNAPSHOTS, snapshot, 8_000_000);

  const history = readJsonLines<StorageSnapshot>(SNAPSHOTS, (s) => typeof s.at === 'string' && Array.isArray(s.relations));
  const heartbeats = [...heartbeatsFor(SCHEDULED_JOBS.filter((j) => j.label !== 'com.mfm.video-scripter-storage-guard'), ROOT),
                      ...EXTERNAL_HEARTBEATS];
  const report = buildGuardReport(history, readOutcomes(path.join(ROOT, 'logs', 'job-outcomes.jsonl')), heartbeats);

  console.log(`[${new Date().toISOString()}] ${report.summary}`);
  for (const a of report.alerts) console.log(`  ALERT ${a}`);
  if (report.status === 'warn' && !NO_ALERT) {
    notify('Video Scripter storage', `${report.alerts.length} alert(s): ${report.alerts[0]}`);
  }
  if (!NO_ALERT) pulse(report.status, [report.summary, ...report.alerts].join(' | '));
  recordOutcome({ job: JOB, status: 'progressed', progressed: 1, backlog: report.alerts.length,
                  detail: report.summary });
  process.exitCode = report.status === 'warn' ? 2 : 0;
} catch (err) {
  console.error(err);
  recordOutcome({ job: JOB, status: 'failed', progressed: 0, backlog: null, detail: (err as Error).message });
  if (!NO_ALERT) {
    notify('Video Scripter storage guard FAILED', (err as Error).message);
    pulse('fail', `storage guard failed: ${(err as Error).message}`);
  }
  process.exitCode = 1;
} finally {
  await pool.end();
}
