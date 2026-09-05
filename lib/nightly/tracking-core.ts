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

// DENSE MODE (modeling window, Sept 2026): tiers 0-3 sampled daily to rebuild
// the envelope/velocity/prediction models on unbiased dense data; archive weekly.
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

/**
 * Videos due tonight that the RSS poller already read today. YouTube's channel feed carries a
 * view count for each of the channel's newest 15 videos, and the poller samples every feed
 * on every tick (zero quota). For those videos the nightly API read is redundant: the latest
 * RSS reading of the day becomes tonight's view_snapshots row and the video is parked on its
 * tier cadence like any other read. Measured 2026-09-05: ~53K of ~145K due videos.
 */
export const RSS_ROLL_SQL = `
  select distinct on (r.video_id) r.video_id, r.views, r.likes, p.priority_tier,
         (current_date - v.published_at::date) as days_since_published
    from rss_samples r
    join view_tracking_priority p on p.video_id = r.video_id
    join videos v on v.id = r.video_id
   where r.at > now() - interval '20 hours'
     and r.views > 0
     and (p.next_track_date is null or p.next_track_date <= $1)
   order by r.video_id, r.at desc`;

export interface RssRollRow { video_id: string; views: number; likes: number | null; priority_tier: number; days_since_published: number | null }

/** The snapshot + schedule rows an RSS reading turns into. Pure. */
export function rssRollRows(rows: RssRollRow[], today: string): SnapshotRow[] {
  return rows.map((r) => ({
    video_id: r.video_id,
    snapshot_date: today,
    view_count: Number(r.views),
    like_count: r.likes == null ? null : Number(r.likes),
    comment_count: null,
    days_since_published: r.days_since_published == null ? null : Number(r.days_since_published),
    daily_views_rate: null,
    next_track_date: nextTrackDate(Number(r.priority_tier), today),
  }));
}

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
  like_count: number | null;
  comment_count: number | null;
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

// ---------------------------------------------------------------- catalog slice
//
// PROBLEM (2026-09-03): the nightly due-list is ordered by priority_tier asc and capped at
// maxApiCalls*50. Tiers 0-2 (232K videos) fill that cap every night, so tiers 3/4 (678K videos
// older than ~2 years) have not been read since Jul/Aug 2025 and hold exactly ONE view_snapshots
// row each. With no second reading there is no growth measurement past ~14 months, which is why
// fitLongTail (lib/scoring/core.ts) has n=0 in the 730d and 1500d buckets and carries 1.31
// forward — against Brandon's own Analytics medians of 1.7 (1-2y), 2.7 (2-4y), 11.7 (4y+).
//
// FIX: a reserved slice of the nightly run that reads the OLDEST-READ archive rows, round-robin.
// At the default 15,000/night the 678K-row tier>=3 pool rotates in ~45 nights, and every video
// gains a second reading with a ~1 year span — exactly the measurement the tail fit is missing.

/** Only the archive tiers are eligible; tiers 0-2 are the main due-list's job. */
export const CATALOG_MIN_TIER = 3;
/** Do not park a catalogue video further out than this, whatever the pool size implies. */
export const CATALOG_MAX_CYCLE_DAYS = 90;

export interface CatalogCandidate {
  video_id: string;
  priority_tier: number;
  last_tracked: string | null;
  days_since_published: number | null;
}

/**
 * Which archive videos this night's catalogue slice reads.
 * Oldest-read first, tier>=3 only, capped at `limit`. Ties break on video_id so a night is
 * deterministic.
 *
 * NULL last_tracked sorts LAST, not first. MEASURED 2026-09-03: of the 678,242 tier>=3 rows,
 * 475,847 were last read in Jul/Aug 2025 (one snapshot each, ~13 months stale — the population
 * the long-tail fit is missing) and 201,409 have last_tracked = NULL. A 1,000-video sample of
 * the NULL rows was 42% already snapshotted inside the last week and 58% never snapshotted at
 * all: on this corpus NULL means "imported recently, ingest already read it", not "starved".
 * Taking them first (the obvious `nulls first`) spent a whole slice on 1-2 day spans and
 * produced ratios of 1.00 — no tail signal. Dated-oldest-first gets a ~13-month span per video.
 */
export function selectCatalogSlice<T extends CatalogCandidate>(candidates: T[], limit: number): T[] {
  if (!(limit > 0)) return [];
  const eligible = candidates.filter((c) => Number(c.priority_tier) >= CATALOG_MIN_TIER);
  eligible.sort((a, b) => {
    const at = a.last_tracked ? new Date(a.last_tracked).getTime() : Infinity;
    const bt = b.last_tracked ? new Date(b.last_tracked).getTime() : Infinity;
    if (at !== bt) return at - bt;
    return a.video_id < b.video_id ? -1 : a.video_id > b.video_id ? 1 : 0;
  });
  return eligible.slice(0, Math.floor(limit));
}

/** Nights for one full pass of the archive pool at `sliceSize` videos per night. */
export function catalogCycleDays(poolSize: number, sliceSize: number): number {
  if (!(sliceSize > 0)) return CATALOG_MAX_CYCLE_DAYS;
  return Math.min(Math.max(1, Math.ceil(poolSize / sliceSize)), CATALOG_MAX_CYCLE_DAYS);
}

/**
 * Where a catalogue video is parked after it is read. tier 3 is "daily" in DENSE MODE, so
 * nextTrackDate() would put it straight back in tomorrow's due-list and break the round-robin;
 * the catalogue parks it one full rotation out instead.
 */
export function catalogNextTrackDate(today: string, cycleDays: number): string {
  const d = new Date(today + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + Math.max(1, Math.floor(cycleDays)));
  return d.toISOString().split('T')[0];
}

/**
 * Candidates for the slice, straight off the (priority_tier, last_tracked) ordering.
 * $1 = min tier, $2 = limit. The final pick still goes through selectCatalogSlice so the
 * ordering and the tier floor are guaranteed by a tested pure function, not only by SQL.
 */
export const CATALOG_CANDIDATES_SQL = `select p.video_id, p.priority_tier, p.last_tracked::text as last_tracked,
          (current_date - v.published_at::date) as days_since_published
     from view_tracking_priority p
     join videos v on v.id = p.video_id
    where p.priority_tier >= $1
    order by p.last_tracked asc nulls last, p.video_id
    limit $2`;

export const CATALOG_POOL_SQL = `select count(*)::int as n from view_tracking_priority where priority_tier >= $1`;
