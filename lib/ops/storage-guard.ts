// The daily storage guard's decision, as pure functions. scripts/storage-guard.ts does the I/O.
//
// One report, four questions:
//   1. Is every table within its storage contract?      (lib/ops/storage-contract.ts)
//   2. Is any table growing faster than it declared?     (7-day rate from the snapshot history)
//   3. When does the data volume hit Supabase's 90 % autoscale trigger at the current rate?
//   4. Has any scheduled job gone quiet, kept failing, or kept doing nothing with work waiting?
//                                                        (lib/ops/job-outcomes.ts)
import {
  evaluateContracts, evaluateGrowth, growthRates, projectDisk, type StorageSnapshot,
} from './storage-contract';
import { detectSilentJobs, type Heartbeat, type JobOutcome } from './job-outcomes';

/** Warn when the volume is projected to reach the autoscale trigger within this many days. */
export const DISK_WARN_DAYS = 30;
/** Supabase auto-expands the disk at 90 % used. */
export const AUTOSCALE_TRIGGER = 0.9;
/** Warn regardless of rate above this fraction used. */
export const DISK_WARN_FRACTION = 0.8;

export interface GuardReport {
  status: 'pass' | 'warn';
  summary: string;
  alerts: string[];
}

const MB = 1024 * 1024;
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export function buildGuardReport(
  snapshots: readonly StorageSnapshot[], outcomes: readonly JobOutcome[], heartbeats: readonly Heartbeat[],
  now = new Date(),
): GuardReport {
  const sorted = [...snapshots].sort((a, b) => a.at.localeCompare(b.at));
  const last = sorted.at(-1);
  const alerts: string[] = [];
  if (!last) return { status: 'warn', summary: 'no snapshot', alerts: ['storage guard: no snapshot taken'] };

  for (const v of evaluateContracts(last.relations)) alerts.push(v.message);
  const rates = growthRates(sorted, 7);
  const current = new Map(last.relations.map((r) => [r.name, r.totalBytes / MB]));
  for (const v of evaluateGrowth(rates, undefined, current)) alerts.push(v.message);

  const disk = projectDisk(sorted, AUTOSCALE_TRIGGER, 7);
  let diskLine = 'disk metrics unavailable';
  if (!disk) {
    alerts.push('storage guard: disk metrics unavailable — cannot project the autoscale trigger');
  } else {
    diskLine = `disk ${Math.round(disk.usedFraction * 100)} % of ${fmt(disk.sizeMb)} MB` +
      (disk.mbPerDay != null ? `, ${fmt(disk.mbPerDay)} MB/day` : '') +
      (disk.daysToThreshold != null ? `, 90 % in ${Math.round(disk.daysToThreshold)} days` : '');
    if (disk.daysToThreshold != null && disk.daysToThreshold < DISK_WARN_DAYS) {
      alerts.push(`data volume reaches the 90 % autoscale trigger in ${Math.round(disk.daysToThreshold)} days ` +
                  `at ${fmt(disk.mbPerDay!)} MB/day (${fmt(disk.usedMb)} of ${fmt(disk.sizeMb)} MB used)`);
    } else if (disk.usedFraction > DISK_WARN_FRACTION) {
      alerts.push(`data volume is ${Math.round(disk.usedFraction * 100)} % used (${fmt(disk.usedMb)} of ${fmt(disk.sizeMb)} MB)`);
    }
  }

  for (const a of detectSilentJobs(outcomes, heartbeats, now)) alerts.push(a.message);

  const top = [...last.relations].sort((a, b) => b.totalBytes - a.totalBytes).slice(0, 3)
    .map((r) => `${r.name} ${fmt(r.totalBytes / MB)}`).join(', ');
  const summary = `${diskLine}; db ${fmt(last.dbBytes / MB)} MB; top: ${top}; ${alerts.length} alert(s)`;
  return { status: alerts.length ? 'warn' : 'pass', summary, alerts };
}

/** The Supabase data volume (mountpoint /data) from the project's Prometheus metrics text. */
export function parseDiskMetrics(text: string): { sizeBytes: number; availBytes: number } | null {
  const pick = (metric: string) => {
    const line = text.split('\n').find((l) => l.startsWith(metric + '{') && l.includes('mountpoint="/data"'));
    return line ? Number(line.trim().split(/\s+/).at(-1)) : NaN;
  };
  const sizeBytes = pick('node_filesystem_size_bytes');
  const availBytes = pick('node_filesystem_avail_bytes');
  return Number.isFinite(sizeBytes) && Number.isFinite(availBytes) ? { sizeBytes, availBytes } : null;
}
