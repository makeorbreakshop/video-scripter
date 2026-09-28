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
/**
 * Warn when queries spill more than this to temp files per day. Spills are transient, but they
 * land on the same volume the 90 % trigger watches. Since 2026-09-04 the rate has been ~3.5 GB/day
 * and near zero once the observation queue-claim and rss_response_state rewrites landed.
 */
export const TEMP_WARN_GB_PER_DAY = 20;

/** WAL above this per day is worth attributing: it is shipped off-host (backups/PITR). */
export const WAL_WARN_GB_PER_DAY = 20;
/** 250 GB org quota / 31 days. The per-project share is the alarm's job; this is a backstop. */
export const TRANSMIT_WARN_GB_PER_DAY = 8;
const GB = 1024 ** 3;

export interface DailyDeltas {
  hours: number;
  temp: number | null;
  wal: number | null;
  transmit: number | null;
  families: { queryid: string; label: string; tempBytes: number; walBytes: number; rows: number }[];
}

/**
 * Per-day deltas of the cumulative counters, measured against the snapshot NEAREST 24 h before
 * the latest (at least 12 h old), scaled to 24 h. The previous form used the immediately previous
 * snapshot, so a manual run two hours after the daily one extrapolated two hours to a day.
 * A counter that went backwards (stats reset) yields null rather than a negative rate.
 */
export function perDay(snapshots: readonly StorageSnapshot[]): DailyDeltas | null {
  const sorted = [...snapshots].sort((a, b) => a.at.localeCompare(b.at));
  const last = sorted.at(-1);
  if (!last) return null;
  const t1 = new Date(last.at).getTime();
  const candidates = sorted.filter((s) => t1 - new Date(s.at).getTime() >= 12 * 3_600_000);
  if (!candidates.length) return null;
  const ref = candidates.reduce((best, s) =>
    Math.abs(t1 - new Date(s.at).getTime() - 86_400_000) < Math.abs(t1 - new Date(best.at).getTime() - 86_400_000) ? s : best);
  const hours = (t1 - new Date(ref.at).getTime()) / 3_600_000;
  const scale = 24 / hours;
  const d = (k: 'tempBytes' | 'walBytes' | 'transmitBytes') => {
    const a = ref[k], b = last[k];
    return typeof a === 'number' && typeof b === 'number' && b >= a ? (b - a) * scale : null;
  };
  const before = new Map((ref.statements ?? []).map((s) => [s.queryid, s]));
  const families = (last.statements ?? []).flatMap((s) => {
    const p = before.get(s.queryid);
    if (!p) return [];
    const diff = (x: number, y: number) => Math.max(0, x - y) * scale;
    return [{ queryid: s.queryid, label: s.label, tempBytes: diff(s.tempBytes, p.tempBytes),
              walBytes: diff(s.walBytes, p.walBytes), rows: diff(s.rows, p.rows) }];
  });
  return { hours, temp: d('tempBytes'), wal: d('walBytes'), transmit: d('transmitBytes'), families };
}

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

  const daily = perDay(sorted);
  let tempLine = '';
  if (daily) {
    const top = (k: 'tempBytes' | 'walBytes') => daily.families
      .filter((f) => f[k] > 0).sort((x, y) => y[k] - x[k]).slice(0, 3)
      .map((f) => `${f.label} ${(f[k] / GB).toFixed(1)} GB`).join('; ');
    if (daily.temp != null) {
      // Alert on what a query family can be named for. Temp files are transient (not persistent
      // disk); on 2026-09-28 ~60 GB/day of pg_stat_database temp_bytes was sub-second files that
      // pg_stat_statements never attributes — reported, not paged on.
      const attributed = daily.families.length
        ? daily.families.reduce((sum, f) => sum + f.tempBytes, 0) : daily.temp;
      tempLine = `; temp spills ${(daily.temp / GB).toFixed(1)} GB/day (${(attributed / GB).toFixed(1)} attributed)`;
      if (attributed / GB > TEMP_WARN_GB_PER_DAY) {
        alerts.push(`temp-file spills ${(attributed / GB).toFixed(1)} GB/day attributed (over ${TEMP_WARN_GB_PER_DAY}; ${(daily.temp / GB).toFixed(1)} total)` +
                    (top('tempBytes') ? `; top: ${top('tempBytes')}` : ''));
      }
    }
    if (daily.wal != null && daily.wal / GB > WAL_WARN_GB_PER_DAY) {
      alerts.push(`WAL ${(daily.wal / GB).toFixed(1)} GB/day (over ${WAL_WARN_GB_PER_DAY}; WAL is archived off-host and shows up as network transmit)` +
                  (top('walBytes') ? `; top: ${top('walBytes')}` : ''));
    }
    if (daily.transmit != null && daily.transmit / GB > TRANSMIT_WARN_GB_PER_DAY) {
      alerts.push(`network transmit ${(daily.transmit / GB).toFixed(1)} GB/day (over ${TRANSMIT_WARN_GB_PER_DAY}, the org egress break-even)`);
    }
  }

  for (const a of detectSilentJobs(outcomes, heartbeats, now)) alerts.push(a.message);

  const top = [...last.relations].sort((a, b) => b.totalBytes - a.totalBytes).slice(0, 3)
    .map((r) => `${r.name} ${fmt(r.totalBytes / MB)}`).join(', ');
  const summary = `${diskLine}; db ${fmt(last.dbBytes / MB)} MB${tempLine}; top: ${top}; ${alerts.length} alert(s)`;
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
