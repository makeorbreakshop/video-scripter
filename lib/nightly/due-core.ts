// Pure logic for the DUE-BASED view tracker (scripts/track-due.ts).
//
// WHY (Brandon, 2026-09-05): "Why is the run at 3 am? These should get triggered as they need
// to by when they were released, and we batch so it's efficient." The 3 AM nightly read a
// whole day's worth of videos in one burst against a date column (next_track_date), so a video
// published at 14:00 was next read at 03:30 — 13.5h late — and the day's quota was spent in
// one 40-minute spike. This module replaces that with a per-video clock:
//
//   next read = last read + the interval of the tier the video is in AT THAT READ
//   first read (never read) = published_at + that same interval
//
// The tier is recomputed from age on every read, so a video rolls off to a sparser cadence by
// itself as it gets older. scripts/track-due.ts drains whatever is due every 15 minutes inside
// a per-tick slice of the day's quota (see tickBudget), so the spend is flat across the day.
//
// The launch tracker (scripts/launch-track.ts, lib/nightly/launch-core.ts) still owns 0-72h on
// its own videos:batchGetStats bucket; this drainer takes over from there.
//
// HARD RULE (shared with tracking-core, enforced by the tests): nothing in this path may touch
// the Supabase REST API — its egress is metered and once took down production
// (2026-08-31 exceed_egress_quota incident). Direct Postgres only.

import { TIER_INTERVAL_DAYS, clampCount, type SnapshotRow } from './tracking-core';

const MS_DAY = 86_400_000;

/** Age in days at which a video drops to the next sparser tier. */
export const DUE_TIER_BOUNDARIES = [30, 180, 730] as const;

/**
 * The day's call allowance for the drain. 6,000 was the intent — "leave the rest for the app
 * and scoring" — but neither bucket actually has 6,000 free, MEASURED 2026-09-05:
 *
 *   videos:batchGetStats (10,000/day, where these reads go)
 *     launch-track already spends 3,000-4,400/day of it   -> ~5,600 free
 *   main key (10,000/day)
 *     ingest, discovery and scoring spend ~6,700/day       -> ~3,300 free
 *
 * So 4,000 on the batchGetStats bucket: 4,000 + launch-track's 4,400 worst case = 8,400, with
 * 1,600 of headroom. That is still 200,000 video reads a day, comfortably above the ~166K/day
 * the tier ladder actually demands once the RSS roll-in has taken its share, and it drains the
 * 855K backlog in under a week. Raise it with --budget once launch-track's share is known to
 * have settled.
 */
export const TRACK_DUE_DAILY_BUDGET = 4000;
/** com.mfm.video-scripter-track-drain fires every 15 minutes. */
export const TICK_INTERVAL_MIN = 15;
/** One videos.list / batchGetStats call carries 50 ids for 1 unit. */
export const IDS_PER_CALL = 50;
/** Stop a tick after this long so it never overruns the next one. */
export const TICK_SOFT_DEADLINE_MS = 5 * 60_000;
/**
 * The handoff. scripts/launch-track.ts runs its own 5-minute ladder over the first 72 hours on
 * the videos:batchGetStats bucket and writes the same view_snapshots rows; this drainer would
 * only be reading those videos a second time, so it takes over where that ladder ends.
 */
export const LAUNCH_HANDOFF_HOURS = 72;

/**
 * Which tier a video of this age belongs in, re-evaluated on every read.
 *   <30d daily · <180d every 3 days · <2y weekly · beyond that fortnightly.
 * `currentTier` only matters for tier 0, which is the launch marker: it shares tier 1's daily
 * interval, so a video already flagged 0 keeps that flag rather than being silently renumbered.
 */
export function tierForAge(ageDays: number, currentTier?: number | null): number {
  const [young, mid, old] = DUE_TIER_BOUNDARIES;
  if (ageDays < young) return currentTier === 0 ? 0 : 1;
  if (ageDays < mid) return 2;
  if (ageDays < old) return 3;
  return 4;
}

export function dueTierIntervalDays(tier: number): number {
  return TIER_INTERVAL_DAYS[tier] ?? 7;
}

/** Whole days elapsed between two instants (never negative). */
export function ageDaysAt(publishedAt: Date, at: Date): number {
  return Math.max(0, Math.floor((at.getTime() - publishedAt.getTime()) / MS_DAY));
}

export interface DueSchedule {
  tier: number;
  next_track_at: Date;
}

/**
 * When this video should next be read, on its own clock.
 *
 * `lastReadAt` null means the video has never been read: its first reading is due one interval
 * after it was PUBLISHED, not one interval from now — so a video imported today with a 2023
 * publish date is due immediately (its first read is years overdue) rather than being parked a
 * fortnight into the future.
 */
export function nextTrackAt(
  publishedAt: Date,
  lastReadAt: Date | null,
  currentTier?: number | null
): DueSchedule {
  const base = lastReadAt ?? publishedAt;
  const tier = tierForAge(ageDaysAt(publishedAt, base), currentTier);
  return { tier, next_track_at: new Date(base.getTime() + dueTierIntervalDays(tier) * MS_DAY) };
}

// ---------------------------------------------------------------- budget
/**
 * The call allowance for THIS tick: what is left of the day's budget, spread evenly over the
 * ticks that remain. Pure. A tick that cannot use its slice simply leaves the work due, and the
 * next tick's slice is larger because `ticksLeft` shrank.
 */
export function tickBudget(spentToday: number, dailyBudget: number, ticksLeft: number): number {
  const remaining = dailyBudget - spentToday;
  if (!(remaining > 0)) return 0;
  return Math.floor(remaining / Math.max(1, ticksLeft));
}

/** Ticks of `intervalMin` minutes left before the quota day (UTC) rolls over. */
export function ticksLeftInDay(now: Date, intervalMin: number): number {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((midnight - now.getTime()) / (intervalMin * 60_000)));
}

/** How many video ids a call budget is worth. */
export function idCapForBudget(calls: number): number {
  return Math.max(0, Math.floor(calls)) * IDS_PER_CALL;
}

/**
 * How many due ids to pull for a tick that can spend `apiIdCap` of them on the API. The excess
 * is headroom for the RSS roll-in: those videos cost no quota, so a tick that fetched only
 * `apiIdCap` ids would let free readings crowd out paid ones and drain slower than it could.
 */
export const DUE_OVERFETCH = 4;
export function dueFetchCap(apiIdCap: number): number {
  return Math.min(apiIdCap * DUE_OVERFETCH, 50_000);
}

export interface DueRow { video_id: string; priority_tier: number; published_at: Date | string }

// The RSS roll-in lived here until 2026-09-06. It turned a channel-feed view count into a due
// video's daily snapshot at zero quota. Removed with the feed poller's demotion: YouTube's
// robots.txt disallows /feeds/videos.xml and its terms forbid automated access outside the API,
// and view_samples from videos.list was already the source of truth for scoring. Every due
// video is an API read again — measured cost of the change is ~+1,100 units/day.

export type DueSnapshotRow = Omit<SnapshotRow, 'next_track_date'> & DueSchedule;

// ---------------------------------------------------------------- API due select
/**
 * The tick's API work: everything overdue, oldest-due first so nothing can starve.
 * Served by idx_vtp_next_track_at (see sql/add_next_track_at.sql) — an index-ordered scan with
 * a LIMIT, so the cost is the cap, not the size of the backlog.
 * $1 = id cap for this tick.
 */
export const DUE_SELECT_SQL = `
  select p.video_id, p.priority_tier, v.published_at
    from view_tracking_priority p
    join videos v on v.id = p.video_id
   where p.next_track_at <= now()
     and v.published_at < now() - interval '72 hours'
   order by p.next_track_at asc
   limit $1`;

/** Build the snapshot + schedule rows for one API batch. Pure. */
export function buildDueRows(
  apiItems: Array<{ id: string; statistics?: Record<string, string> }>,
  due: Map<string, DueRow>,
  prev: Map<string, { view_count: number; snapshot_date: string }>,
  now: Date
): DueSnapshotRow[] {
  const today = now.toISOString().split('T')[0];
  const out: DueSnapshotRow[] = [];
  for (const item of apiItems) {
    const meta = due.get(item.id);
    if (!meta) continue;
    const stats = item.statistics || {};
    const viewCount = clampCount(parseInt(stats.viewCount || '0', 10));
    const published = new Date(meta.published_at);

    let dailyViewsRate: number | null = null;
    const p = prev.get(item.id);
    if (p && p.view_count != null) {
      const days = Math.ceil((new Date(today).getTime() - new Date(p.snapshot_date).getTime()) / MS_DAY);
      if (days > 0) dailyViewsRate = Math.round((viewCount - p.view_count) / days);
    }

    out.push({
      video_id: item.id,
      snapshot_date: today,
      view_count: viewCount,
      like_count: clampCount(parseInt(stats.likeCount || '0', 10)),
      comment_count: clampCount(parseInt(stats.commentCount || '0', 10)),
      days_since_published: ageDaysAt(published, now),
      daily_views_rate: dailyViewsRate,
      ...nextTrackAt(published, now, meta.priority_tier),
    });
  }
  return out;
}
