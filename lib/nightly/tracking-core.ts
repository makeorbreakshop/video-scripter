// Pure logic for the nightly direct-Postgres pipeline.
// HARD RULE (enforced by tracking-core.test.ts): nothing in the nightly path
// may touch the Supabase REST API — its egress is metered and once took down
// production (2026-08-31 exceed_egress_quota incident). Direct Postgres only.

// DENSE MODE (modeling window, Sept 2026): tiers 0-3 sampled daily to rebuild
// the envelope/velocity/prediction models on unbiased dense data; archive weekly.
// Revert to the envelope-derived schedule once models ship.
export const TIER_INTERVAL_DAYS: Record<number, number> = {
  0: 1,
  1: 1,
  2: 1,
  3: 1,
  4: 7,
};

export function nextTrackDate(tier: number, today: string): string {
  const days = TIER_INTERVAL_DAYS[tier] ?? 7;
  const d = new Date(today + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

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
  like_count: number;
  comment_count: number;
  days_since_published: number | null;
  daily_views_rate: number | null;
  next_track_date: string;
}

export function buildSnapshotRows(
  apiItems: Array<{ id: string; statistics?: Record<string, string> }>,
  tracked: Map<string, TrackedVideo>,
  prevSnapshots: Map<string, PrevSnapshot>,
  today: string
): SnapshotRow[] {
  const rows: SnapshotRow[] = [];
  for (const item of apiItems) {
    const meta = tracked.get(item.id);
    if (!meta) continue;
    const stats = item.statistics || {};
    const viewCount = parseInt(stats.viewCount || '0', 10);

    let dailyViewsRate: number | null = null;
    const prev = prevSnapshots.get(item.id);
    if (prev && prev.view_count != null) {
      const daysBetween = Math.ceil(
        (new Date(today).getTime() - new Date(prev.snapshot_date).getTime()) / 86400000
      );
      if (daysBetween > 0) dailyViewsRate = Math.round((viewCount - prev.view_count) / daysBetween);
    }

    rows.push({
      video_id: item.id,
      snapshot_date: today,
      view_count: clampCount(viewCount),
      like_count: clampCount(parseInt(stats.likeCount || '0', 10)),
      comment_count: clampCount(parseInt(stats.commentCount || '0', 10)),
      days_since_published: meta.days_since_published,
      daily_views_rate: dailyViewsRate,
      next_track_date: nextTrackDate(meta.priority_tier, today),
    });
  }
  return rows;
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
