// Pure logic for the direct-Postgres tracking pipeline.
//
// SCHEDULING MOVED (2026-09-05): the 3 AM nightly is retired. Videos are read on their own
// clock — view_tracking_priority.next_track_at — drained every 15 minutes by
// scripts/track-due.ts; see lib/nightly/due-core.ts. TIER_INTERVAL_DAYS below is still the
// single source of the tier cadences and due-core reads it from here. The date-grained
// helpers left in this file (nextTrackDate, RSS_ROLL_SQL, the catalogue-slice block) belong to
// the retired nightly and to lib/view-tracking-service.ts; nothing in the drain path uses them.
// HARD RULE (enforced by tracking-core.test.ts): nothing in the nightly path
// may touch the Supabase REST API — its egress is metered and once took down
// production (2026-08-31 exceed_egress_quota incident). Direct Postgres only.

// The age-derived schedule (restored 2026-09-05, Brandon: "go"). It had been flattened to daily
// for every tier under two years while the models were being fit; with v5 shipped and the RSS
// poller covering each channel's newest 15 videos for free (see RSS_ROLL_SQL), the nightly
// API read can roll off with age again. Tier 0-1: launch + first month, daily. Tier 2 (~1-6
// months): every 3 days. Tier 3 (~6 months-2 years): weekly. Tier 4: fortnightly, and the
// catalogue slice keeps the archive rotating regardless.
export const TIER_INTERVAL_DAYS: Record<number, number> = {
  0: 1,
  1: 1,
  2: 3,
  3: 7,
  4: 14,
};

export interface TrackedVideo {
  priority_tier: number;
  days_since_published: number | null;
}

export interface PrevSnapshot {
  view_count: number;
  snapshot_date: string;
}

export interface SnapshotRow {
  video_id: string;
  snapshot_date: string;
  view_count: number;
  like_count: number | null;
  comment_count: number | null;
  days_since_published: number | null;
  daily_views_rate: number | null;
  next_track_date: string;
}

// Postgres count columns are int32; mega-videos (2B+ views) overflow them.
// Clamp until the columns are widened to bigint.
export const INT32_MAX = 2147483647;
export function clampCount(n: number): number {
  return Number.isFinite(n) ? Math.min(Math.max(0, Math.trunc(n)), INT32_MAX) : 0;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function parseRssVideoIds(xml: string): string[] {
  const ids: string[] = [];
  const re = /<yt:videoId>([A-Za-z0-9_-]{6,20})<\/yt:videoId>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) ids.push(m[1]);
  return ids;
}
