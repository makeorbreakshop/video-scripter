import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Qdrant was silently down for 12 days (2026-10-26 → 2026-11-07) while the hourly sync failed into
 * a log nobody read. When the preflight refuses to run, raise a macOS notification and a Pulse
 * "fail" receipt — at most once per interval so an overnight outage pages once, not hourly.
 */
export const OUTAGE_ALERT_INTERVAL_MS = 6 * 60 * 60_000;

export function shouldAlert(lastAlertAt: Date | null, now: Date, intervalMs = OUTAGE_ALERT_INTERVAL_MS): boolean {
  return lastAlertAt === null || Number.isNaN(lastAlertAt.getTime()) || now.getTime() - lastAlertAt.getTime() >= intervalMs;
}

export interface OutageAlertDeps {
  statePath: string;
  now: () => Date;
  notify: (title: string, message: string) => void;
  pulse: (summary: string) => void;
}

function readLast(statePath: string): Date | null {
  try { return new Date(fs.readFileSync(statePath, 'utf8').trim()); } catch { return null; }
}

/** Returns true when an alert was sent. Never throws: alerting must not mask the original failure. */
export function alertQdrantOutage(reason: string, deps: OutageAlertDeps): boolean {
  try {
    const now = deps.now();
    if (!shouldAlert(readLast(deps.statePath), now)) return false;
    const message = `Semantic sync skipped: ${reason}. Semantic search is not updating. Start it: colima start channelsmith`;
    deps.notify('ChannelSmith Qdrant is down', message);
    deps.pulse(message);
    fs.mkdirSync(path.dirname(deps.statePath), { recursive: true });
    fs.writeFileSync(deps.statePath, now.toISOString());
    return true;
  } catch (error) {
    console.error(`qdrant outage alert failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

function macNotify(title: string, message: string): void {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').slice(0, 240);
  spawnSync('osascript', ['-e', `display notification "${esc(message)}" with title "${esc(title)}" sound name "Basso"`]);
}

/** Pulse operations receipt, same reporter the storage guard uses. Best effort. */
function pulseFail(summary: string): void {
  const reporter = path.join(os.homedir(), '.local', 'bin', 'report-pulse-operation');
  if (!fs.existsSync(reporter)) return;
  if (!process.env.PULSE_OPERATIONS_TOKEN_FILE && !process.env.PULSE_OPERATIONS_TOKEN) return;
  spawnSync(reporter, ['report', '--job-id', 'studio-video-scripter-semantic-sync',
    '--name', 'Video Scripter semantic sync', '--kind', 'launchd', '--schedule', 'hourly',
    '--status', 'fail', '--summary', summary.slice(0, 900), '--project-ref', 'video-scripter'], { encoding: 'utf8' });
}

export function defaultOutageAlertDeps(): OutageAlertDeps {
  return {
    statePath: process.env.SEMANTIC_OUTAGE_ALERT_STATE
      ?? path.join(os.homedir(), 'qdrant', 'channelsmith-alert', 'last-outage-alert'),
    now: () => new Date(),
    notify: macNotify,
    pulse: pulseFail,
  };
}
