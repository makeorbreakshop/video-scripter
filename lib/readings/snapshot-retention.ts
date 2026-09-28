// PROPOSED retention for view_snapshots (2026-09-26). Pure policy + a read-only estimate; nothing
// deletes with it yet. Brandon decides; see docs/runbooks/2026-09-26-disk-growth.md §view_snapshots.
//
// view_snapshots is the daily truth per tracked video (scripts/track-due.ts), read by scoring,
// baselines and charts. It had no retention at all — CLAUDE.md describes a monthly >1-year cleanup
// that does not exist. The policy is by the VIDEO's age (days_since_published), because every
// reader asks "views at age N", and it keeps a video's launch month whole:
//
//   snapshot newer than protectDays     untouched
//   video age <= fullDays (30)          every snapshot
//   video age <= weeklyUntil (365)      the last snapshot of each week of age
//   older                               the last snapshot of each 30 days of age
//   always                              the video's first and last snapshot
//
// Before any delete: archive view_snapshots to R2 per snapshot_date with the same
// write → read back → checksum ledger the readings use (lib/readings/archive.ts), and thin only
// verified days (decideThin). Measure chart/score impact with scripts/verify-archive.ts first.

import { createHash } from 'node:crypto';

export const SNAPSHOT_RETENTION = { protectDays: 90, fullDays: 30, weeklyUntilDays: 365 } as const;

export interface Snapshot { video_id: string; snapshot_date: string; days_since_published: number; view_count: number }

export function snapshotBucket(age: number, policy = SNAPSHOT_RETENTION): string {
  if (age <= policy.fullDays) return `d${age}`;
  if (age <= policy.weeklyUntilDays) return `w${Math.floor(age / 7)}`;
  return `m${Math.floor(age / 30)}`;
}

export function snapshotSurvivors<T extends Snapshot>(rows: readonly T[], now: Date, policy = SNAPSHOT_RETENTION): T[] {
  const cutoff = new Date(now.getTime() - policy.protectDays * 86_400_000).toISOString().slice(0, 10);
  const byVideo = new Map<string, T[]>();
  for (const r of rows) byVideo.set(r.video_id, [...(byVideo.get(r.video_id) ?? []), r]);
  const keep = new Set<T>();
  for (const list of byVideo.values()) {
    const sorted = [...list].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
    keep.add(sorted[0]);
    keep.add(sorted[sorted.length - 1]);
    const lastOf = new Map<string, T>();
    for (const r of sorted) {
      if (r.snapshot_date >= cutoff || r.days_since_published <= policy.fullDays) { keep.add(r); continue; }
      lastOf.set(snapshotBucket(r.days_since_published, policy), r);
    }
    for (const r of lastOf.values()) keep.add(r);
  }
  return rows.filter((r) => keep.has(r));
}

/** How many rows / bytes the proposal would keep, as one aggregate row. Read-only. */
export const SNAPSHOT_ESTIMATE_SQL = `
  with x as (
    select snapshot_date,
           (snapshot_date >= current_date - ${SNAPSHOT_RETENTION.protectDays}
            or days_since_published <= ${SNAPSHOT_RETENTION.fullDays}
            or row_number() over (partition by video_id order by snapshot_date) = 1
            or row_number() over (partition by video_id order by snapshot_date desc) = 1
            or row_number() over (
                 partition by video_id,
                   case when days_since_published <= ${SNAPSHOT_RETENTION.weeklyUntilDays}
                        then 'w' || (days_since_published / 7) else 'm' || (days_since_published / 30) end
                 order by snapshot_date desc) = 1) as keep
      from view_snapshots
  )
  select count(*) as total, count(*) filter (where keep) as kept,
         count(*) filter (where not keep) as removable,
         count(*) filter (where not keep and snapshot_date < current_date - 365) as removable_over_1y
    from x`;

// ---- applying it (approved 2026-09-28) ------------------------------------------------------

const TABLE = /^(pg_temp\.)?[a-z_][a-z0-9_]*$/;

/**
 * Delete, from ONE snapshot_date ($1), the rows snapshotSurvivors() would not keep. Every rule is
 * a probe on the unique (video_id, snapshot_date) index, so the cost is bounded by the day's rows.
 * Mirrors the pure policy exactly (snapshot-retention.integration.test.ts compares them):
 *   - protected: newer than protectDays, or the video was <= fullDays old;
 *   - first and last snapshot of the video;
 *   - the latest unprotected snapshot of each age bucket (week of age to a year, then 30 days).
 * Only ever run for a day the ledger records as archived and read back from R2 (thin-snapshots.ts).
 */
export function snapshotThinDaySql(table = 'view_snapshots', policy = SNAPSHOT_RETENTION): string {
  if (!TABLE.test(table)) throw new Error(`not a table name: ${table}`);
  const { protectDays: p, fullDays: f, weeklyUntilDays: w } = policy;
  const lo = `case when s.days_since_published <= ${w} then greatest((s.days_since_published / 7) * 7, ${f + 1})
                   else greatest((s.days_since_published / 30) * 30, ${w + 1}) end`;
  const hi = `case when s.days_since_published <= ${w} then least((s.days_since_published / 7) * 7 + 6, ${w})
                   else (s.days_since_published / 30) * 30 + 29 end`;
  return `
    delete from ${table} s
     where s.snapshot_date = $1::date
       and s.snapshot_date < current_date - ${p}
       and s.days_since_published > ${f}
       and exists (select 1 from ${table} e where e.video_id = s.video_id and e.snapshot_date < s.snapshot_date)
       and exists (select 1 from ${table} e where e.video_id = s.video_id and e.snapshot_date > s.snapshot_date)
       and exists (select 1 from ${table} e where e.video_id = s.video_id and e.snapshot_date > s.snapshot_date
                     and e.snapshot_date < current_date - ${p} and e.days_since_published > ${f}
                     and e.days_since_published between ${lo} and ${hi})`;
}

/** Every column of one day, in a fixed order, for the archive. $1 = day. */
export const SNAPSHOT_DAY_SELECT_SQL = `
  select id::text as id, video_id, snapshot_date::text as snapshot_date, view_count, like_count,
         comment_count, days_since_published, daily_views_rate, created_at
    from view_snapshots where snapshot_date = $1::date
   order by id`;

export const SNAPSHOT_DAY_COUNT_SQL = `select count(*)::bigint as n from view_snapshots where snapshot_date = $1::date`;

/** Days old enough to be thinned, oldest first. Index-only on idx_view_snapshots_date. */
export const SNAPSHOT_DAYS_SQL = `
  select distinct snapshot_date::text as day from view_snapshots
   where snapshot_date < current_date - ${SNAPSHOT_RETENTION.protectDays}
   order by 1`;

export interface ArchivedSnapshot {
  id: string; video_id: string; snapshot_date: string; view_count: number | string | null;
  like_count?: number | string | null; comment_count?: number | string | null;
  days_since_published?: number | string | null; daily_views_rate?: number | string | null;
  created_at?: string | Date | null;
}

/** sha256 over the identifying columns, independent of row order. Postgres and R2 must agree. */
export function snapshotChecksum(rows: readonly ArchivedSnapshot[]): string {
  const lines = rows
    .map((r) => `${r.id}|${r.video_id}|${String(r.snapshot_date).slice(0, 10)}|${r.view_count == null ? '' : Number(r.view_count)}`)
    .sort();
  return createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
}
