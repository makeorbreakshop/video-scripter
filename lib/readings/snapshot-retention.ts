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
