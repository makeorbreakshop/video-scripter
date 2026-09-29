// Every scheduled job this repo runs, with what "healthy" means for it.
//
// One registry, three consumers:
//   - scripts/storage-guard.ts turns it into heartbeats (lib/ops/job-outcomes.ts) and alerts on
//     a job that has gone quiet, keeps failing, or keeps choosing to do nothing;
//   - lib/app/video-text-sweep.ts scans these scripts for direct text readers (it used to scan
//     app/ lib/ components/ workers/ only, and missed scripts/rss-poll.ts reading
//     videos.description every five minutes);
//   - scheduled-jobs.test.ts fails when a LaunchAgent exists that this file does not declare, so a
//     new job cannot be scheduled without saying how it will be watched.
//
// `staleAfterHours` is how long the job's stdout log may go unwritten before it counts as not
// running. `ledger` jobs also record outcomes; `maxSilentRuns` is how many consecutive "had work,
// did none" runs are tolerated before the alert.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import type { Heartbeat } from './job-outcomes';

export interface ScheduledJob {
  label: string;
  /** Repo-relative entry points the LaunchAgent runs (the first is the one in the plist). */
  scripts: string[];
  /** Stdout log, repo-relative. */
  log: string;
  staleAfterHours: number;
  ledger?: { job: string; everyHours: number; maxSilentRuns: number };
  /** A last stdout line matching this is a failure even when the log is fresh. */
  failIfLastLine?: RegExp;
}

const L = (name: string) => `logs/${name}-launchd.log`;
const P = 'com.mfm.video-scripter-';

export const SCHEDULED_JOBS: ScheduledJob[] = [
  { label: `${P}archive-readings`, scripts: ['scripts/archive-then-thin.sh', 'scripts/archive-readings.ts', 'scripts/thin-readings.ts', 'scripts/thin-snapshots.ts'],
    log: L('archive-readings'), staleAfterHours: 26,
    ledger: { job: 'thin-readings', everyHours: 24, maxSilentRuns: 3 },
    failIfLastLine: /archive-then-thin: .*(archive|thin|snapshots)=[1-9]/ },
  // Same LaunchAgent, second ledger: the snapshot thinning it runs after thin-readings.
  { label: `${P}archive-readings#snapshots`, scripts: ['scripts/thin-snapshots.ts'], log: L('archive-readings'), staleAfterHours: 26,
    ledger: { job: 'thin-snapshots', everyHours: 24, maxSilentRuns: 3 } },
  { label: `${P}daily-ingest`, scripts: ['scripts/nightly-ingest.ts'], log: L('daily-ingest'), staleAfterHours: 26 },
  { label: `${P}export-tables`, scripts: ['scripts/export-tables.ts'], log: L('export-tables'), staleAfterHours: 26 },
  // Long-running server; its log only moves on restarts and errors.
  { label: `${P}extension-api`, scripts: ['scripts/extension-api-server.ts'], log: L('extension-api'), staleAfterHours: 24 * 30 },
  { label: `${P}feed`, scripts: ['scripts/feed-materialize.ts'], log: L('feed'), staleAfterHours: 2 },
  { label: `${P}launch-track`, scripts: ['scripts/launch-track.ts'], log: L('launch-track'), staleAfterHours: 2 },
  { label: `${P}move-video-text`, scripts: ['scripts/move-video-text.ts'], log: L('move-video-text'), staleAfterHours: 26,
    ledger: { job: 'move-video-text', everyHours: 24, maxSilentRuns: 3 } },
  { label: `${P}null-video-text`, scripts: ['scripts/null-video-text-tonight.ts', 'scripts/null-video-text.ts'],
    log: L('null-video-text'), staleAfterHours: 26,
    ledger: { job: 'null-video-text', everyHours: 24, maxSilentRuns: 3 } },
  { label: `${P}observation-bootstrap`, scripts: ['scripts/bootstrap-observation-cache.ts'], log: L('observation-bootstrap'), staleAfterHours: 2 },
  { label: `${P}observation-materializer`, scripts: ['scripts/materialize-observations.ts'], log: L('observation-materializer'), staleAfterHours: 2 },
  { label: `${P}packaging-counts`, scripts: ['scripts/refresh-packaging-counts.ts'], log: L('packaging-counts'), staleAfterHours: 26 },
  { label: `${P}refresh-sparklines`, scripts: ['scripts/refresh-sparklines.ts'], log: L('refresh-sparklines'), staleAfterHours: 26 },
  { label: `${P}rss-poll`, scripts: ['scripts/rss-poll.ts'], log: L('rss-poll'), staleAfterHours: 2 },
  { label: `${P}score-fit`, scripts: ['scripts/score-videos.ts'], log: L('score-fit'), staleAfterHours: 26 },
  { label: `${P}score`, scripts: ['scripts/score-videos.ts'], log: L('score'), staleAfterHours: 2 },
  { label: `${P}semantic`, scripts: ['scripts/semantic/sync-semantic.ts'], log: L('semantic'), staleAfterHours: 4 },
  { label: `${P}series-drain`, scripts: ['scripts/rebuild-series.ts'], log: L('series-drain'), staleAfterHours: 2 },
  { label: `${P}thumbnail-watch`, scripts: ['scripts/thumbnail-watch.ts'], log: L('thumbnail-watch'), staleAfterHours: 2 },
  { label: `${P}touch-drain`, scripts: ['scripts/drain-touch-queue.ts'], log: L('touch-drain'), staleAfterHours: 2 },
  { label: `${P}track-drain`, scripts: ['scripts/track-drain.ts', 'scripts/track-due.ts'], log: L('track-drain'), staleAfterHours: 2 },
  { label: `${P}verify-shorts`, scripts: ['scripts/verify-shorts.ts'], log: L('verify-shorts'), staleAfterHours: 2 },
  { label: `${P}websub-renew`, scripts: ['scripts/websub-subscribe.ts'], log: L('websub-renew'), staleAfterHours: 3 },
  { label: `${P}weekly-refit`, scripts: ['scripts/weekly-refit.ts'], log: L('weekly-refit'), staleAfterHours: 24 * 8 },
  { label: `${P}storage-guard`, scripts: ['scripts/storage-guard.ts'], log: L('storage-guard'), staleAfterHours: 26 },
];

/**
 * Jobs outside this repo whose silence has already cost us once. The egress alarm threw on every
 * run from 2026-09-10 to 2026-09-26 (HTTP 403 from the api-keys endpoint — for every project: the
 * PAT no longer has access) and its .log just stopped.
 */
export const EXTERNAL_HEARTBEATS: Heartbeat[] = [
  // A fresh log is not enough: with an expired PAT every project 403s and the script used to log
  // "0.0 GB/day across 0 projects" — an all-clear built from no data. It now logs NO DATA.
  { kind: 'file', job: 'supabase-egress-check', everyHours: 24,
    path: path.join(os.homedir(), 'shared-memory', 'logs', 'supabase-egress-check.log'),
    failIfLastLine: /NO DATA|NO TOKEN|across 0 projects/ },
];

/** Heartbeats for every registered job: a stdout-log freshness check, plus the ledger where kept. */
export function heartbeatsFor(jobs: readonly ScheduledJob[], repoRoot: string): Heartbeat[] {
  const out: Heartbeat[] = [];
  for (const j of jobs) {
    out.push({ kind: 'file', job: j.label, path: path.join(repoRoot, j.log), everyHours: j.staleAfterHours / 2,
               ...(j.failIfLastLine ? { failIfLastLine: j.failIfLastLine } : {}) });
    if (j.ledger) out.push({ kind: 'ledger', ...j.ledger });
  }
  return out;
}

/** Every script a scheduled job runs, for the text-reader sweep. */
export const SCHEDULED_SCRIPTS = [...new Set(SCHEDULED_JOBS.flatMap((j) => j.scripts))]
  .filter((s) => s.endsWith('.ts')).sort();

/** Labels of installed video-scripter LaunchAgents, from plist file names (not disabled/backup copies). */
export function installedAgentLabels(dir: string): string[] {
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names
    .filter((n) => n.startsWith('com.mfm.video-scripter-') && n.endsWith('.plist'))
    .map((n) => n.slice(0, -'.plist'.length))
    .sort();
}

/** Installed agents with no registry entry — each one is a job nobody is watching. */
export function unregisteredAgents(installed: readonly string[], jobs: readonly ScheduledJob[]): string[] {
  const known = new Set(jobs.map((j) => j.label));
  return installed.filter((l) => !known.has(l));
}

// ---- Client egress meter (lib/ops/egress-meter.ts) on every agent that runs this repo's code ----

/** Agents outside the video-scripter prefix that still run this repo against Supabase. */
export const OTHER_REPO_AGENTS = ['com.mfm.channelsmith-backfill'];

/** The job name egress is filed under: the label without its prefix ("score", "rss-poll" …). */
export const egressJobName = (label: string) => label.replace(/^com\.mfm\.(video-scripter-)?/, '');

/** The environment a LaunchAgent needs for the meter: preload it, and name the job. */
export function meterEnvFor(label: string, repo: string): { NODE_OPTIONS: string; EGRESS_JOB: string } {
  return { NODE_OPTIONS: `--import ${path.join(repo, 'lib', 'ops', 'egress-meter.ts')}`, EGRESS_JOB: egressJobName(label) };
}

/** Labels whose plist environment does not match meterEnvFor — each is a job with no egress number. */
export function agentsMissingMeter(dir: string, labels: readonly string[], repo: string,
                                   readEnv: (plist: string) => Record<string, string> = plistEnv): string[] {
  return labels.filter((l) => {
    const want = meterEnvFor(l, repo);
    const env = readEnv(path.join(dir, `${l}.plist`));
    return env.NODE_OPTIONS !== want.NODE_OPTIONS || env.EGRESS_JOB !== want.EGRESS_JOB;
  });
}

function plistEnv(plist: string): Record<string, string> {
  try {
    const out = execFileSync('plutil', ['-extract', 'EnvironmentVariables', 'json', '-o', '-', plist], { encoding: 'utf8' });
    return JSON.parse(out);
  } catch { return {}; }
}
