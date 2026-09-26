// Planning a one-time table rewrite that returns bloat to the filesystem.
//
// DELETE and UPDATE never shrink a Postgres file; they leave free space inside it, which plain
// VACUUM makes reusable but does not give back. When a table's high-water mark is far above its
// live size — video_score_history on 2026-09-26: 1,280 MB heap, 94 MB live — only a rewrite
// returns the space. Two ways:
//
//   pg_repack    online. Builds a copy while a trigger captures concurrent writes, then swaps.
//                ACCESS EXCLUSIVE only briefly, at the start and at the swap. Needs a primary key
//                and a version-matched client (scripts/docker/pg-repack.Dockerfile, 1.5.2).
//   VACUUM FULL  holds ACCESS EXCLUSIVE for the WHOLE rewrite: every read and write of the table
//                blocks until it finishes. Only for small tables, and always with a lock_timeout
//                so a request stuck behind a long transaction does not block everyone queued
//                behind IT.
//
// Both need room for a second copy of the live data and its indexes. A big rewrite needs an
// explicit --approved: the reclaim of `videos` is Brandon's decision, not a script's.

export interface ReclaimInput {
  table: string;
  totalBytes: number;
  heapBytes: number;
  toastBytes: number;
  indexBytes: number;
  /** Live tuple bytes (pgstattuple_approx.approx_tuple_len, or an estimate). */
  liveBytes: number;
  diskAvailBytes: number | null;
  /** The volume's size; when known, the rewrite must also stay under the 90 % autoscale trigger. */
  diskSizeBytes?: number | null;
  hasPrimaryKey: boolean;
  repackAvailable: boolean;
  approved?: boolean;
}

export interface ReclaimPlan {
  method: 'pg_repack' | 'vacuum_full' | 'refuse';
  /** Expected MB returned to the filesystem. */
  reclaimMb: number;
  /** Expected size after the rewrite. */
  afterMb: number;
  /** Time the table is unavailable (ACCESS EXCLUSIVE), as a range. */
  lockSeconds: { min: number; max: number };
  /** Expected total runtime, as a range. */
  runSeconds: { min: number; max: number };
  notes: string[];
}

const MB = 1024 * 1024;
/**
 * Sequential throughput assumed for a rewrite on this instance, MB/s. The low end is the Small
 * compute's baseline disk throughput; the high end allows for burst and a warm cache. Measured
 * 2026-09-26: pg_repack of video_score_history did ~1,470 MB of work in 19.4 s ≈ 76 MB/s — the fast
 * end, on a table with two indexes. `videos` has 45; expect nearer the slow end.
 */
export const REWRITE_MBPS = { slow: 20, fast: 80 };
/** A rewrite bigger than this (live data) needs --approved. */
export const APPROVAL_LIVE_MB = 500;
/** Not worth a rewrite below this much reclaim, or below this share of the table. */
export const MIN_RECLAIM_MB = 100;
export const MIN_RECLAIM_SHARE = 0.2;

const IDENT = /^[a-z_][a-z0-9_]*$/;
function ident(t: string): string {
  if (!IDENT.test(t)) throw new Error(`not a plain table name: ${t}`);
  return t;
}

export function planReclaim(i: ReclaimInput): ReclaimPlan {
  const notes: string[] = [];
  // Indexes are rebuilt from the live rows; assume they shrink in proportion to the heap, but
  // never below 30 % of today (a btree packed at fillfactor 90 is not free).
  const fullHeap = i.heapBytes + i.toastBytes;
  const liveShare = fullHeap > 0 ? Math.min(1, i.liveBytes / fullHeap) : 1;
  const indexAfter = i.indexBytes * Math.max(0.3, liveShare);
  const after = i.liveBytes * 1.1 + indexAfter; // 10 % page overhead
  const reclaim = Math.max(0, i.totalBytes - after);
  // Work: read the old heap once, write the live data, read it again per index build, write the indexes.
  const workMb = (fullHeap + i.liveBytes + i.liveBytes + indexAfter) / MB;
  const run = { min: Math.round(workMb / REWRITE_MBPS.fast), max: Math.round(workMb / REWRITE_MBPS.slow) };
  const repack = i.hasPrimaryKey && i.repackAvailable;
  const plan: ReclaimPlan = {
    method: repack ? 'pg_repack' : 'vacuum_full',
    reclaimMb: Math.round(reclaim / MB),
    afterMb: Math.round(after / MB),
    runSeconds: run,
    lockSeconds: repack ? { min: 1, max: 10 } : run,
    notes,
  };
  if (repack) {
    notes.push('pg_repack: online; ACCESS EXCLUSIVE only at start and swap (bounded by --wait-timeout)');
  } else {
    notes.push(`VACUUM FULL: ACCESS EXCLUSIVE for the whole rewrite (${run.min}-${run.max} s estimated)` +
               (i.hasPrimaryKey ? '' : '; pg_repack needs a primary key'));
  }

  const need = 2 * (i.liveBytes * 1.1 + indexAfter);
  if (i.diskAvailBytes == null) {
    notes.push('free disk unknown (metrics unavailable) — refusing rather than guessing');
    plan.method = 'refuse';
  } else if (i.diskAvailBytes < need) {
    notes.push(`free disk ${Math.round(i.diskAvailBytes / MB)} MB < ${Math.round(need / MB)} MB needed for the second copy`);
    plan.method = 'refuse';
  } else if (i.diskSizeBytes && (i.diskSizeBytes - i.diskAvailBytes) + need / 2 > 0.9 * i.diskSizeBytes) {
    // The copy exists alongside the original until the swap. Crossing 90 % triggers a Supabase
    // autoscale, and the disk never shrinks back (review P2-5).
    notes.push('the second copy would push the volume past the 90 % autoscale trigger');
    plan.method = 'refuse';
  }
  if (reclaim / MB < MIN_RECLAIM_MB || reclaim / i.totalBytes < MIN_RECLAIM_SHARE) {
    notes.push(`not worth a rewrite: ~${plan.reclaimMb} MB (${Math.round((100 * reclaim) / i.totalBytes)} %) reclaimable`);
    plan.method = 'refuse';
  }
  if (i.liveBytes / MB > APPROVAL_LIVE_MB && !i.approved) {
    notes.push(`${Math.round(i.liveBytes / MB)} MB of live data: a rewrite this size needs --approved (a human decision)`);
    plan.method = 'refuse';
  }
  return plan;
}

/** The pg_repack invocation: version-matched client in Docker, on the SESSION pooler (:5432). */
export function repackCommand(table: string, waitTimeoutSeconds = 60): string {
  return `set -a; . ./.env.local; set +a; docker run --rm pg-repack:1.5.2-pg15 pg_repack -k ` +
         `-d "$DATABASE_SESSION_URL" -t public.${ident(table)} --wait-timeout ${waitTimeoutSeconds} --elevel=INFO`;
}

/**
 * VACUUM FULL with a lock_timeout, as SEPARATE statements for one session connection: psql sends a
 * single `-c` string as one implicit transaction, and VACUUM refuses to run inside one (review P1-3).
 */
export function VACUUM_FULL_SQL(table: string): string[] {
  return [`set lock_timeout = '5s'`, `set statement_timeout = '15min'`, `vacuum (full, analyze, verbose) public.${ident(table)}`];
}
