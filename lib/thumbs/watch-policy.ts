// Thumbnail watch policy (2026-09-02). Pure functions + SQL text, no I/O.
//
// Five tiers, by how fast packaging is still moving:
//   launch  <6h        every run (LaunchAgent fires every 5 min)
//   hot     6-72h      every ~30 min
//   warm    3-30d      daily
//   cool    30-90d     weekly      <- long tail
//   cold    >90d       monthly     <- long tail
// Every non-Short, non-live video qualifies (is_short false, duration <> 'P0D').
//
// Cost rule: the hot query (launch/hot/warm) only ever touches the 30-day slice of
// videos via idx_videos_published_desc and is selected FIRST, so long-tail work can
// never crowd it out of the per-run cap. The long-tail query is separately capped
// (LONG_TAIL_MAX_PER_RUN) and only runs once an hour (isLongTailRun) because its
// anti-join covers ~850K rows and this DB has had IO incidents.
import { isLongform, longformSql } from '../scoring/longform';

export type Tier = 'launch' | 'hot' | 'warm' | 'cool' | 'cold';

export const TIER_THRESHOLDS = {
  launchMaxAgeHours: 6,
  hotMaxAgeHours: 72,
  hotRecheckMinutes: 25,
  warmMaxAgeDays: 30,
  warmRecheckHours: 23,
  coolMaxAgeDays: 90,
  coolRecheckDays: 7,
  coldRecheckDays: 30,
} as const;

export const LONG_TAIL_TIERS: Tier[] = ['cool', 'cold'];
export const LONG_TAIL_MAX_PER_RUN = 4000;
/** Long tail runs once an hour: the LaunchAgent fires every 5 min, so gate on the first slot. */
export const LONG_TAIL_RUN_MINUTE_WINDOW = 5;

const H = 3600_000;
const D = 24 * H;

/** Age bucket alone — which cadence this video belongs to, ignoring when it was last checked. */
export function tierOf(publishedAt: Date | string | null | undefined, now: Date = new Date()): Tier {
  if (!publishedAt) return 'cold';
  const ageMs = now.getTime() - new Date(publishedAt).getTime();
  if (ageMs < TIER_THRESHOLDS.launchMaxAgeHours * H) return 'launch';
  if (ageMs < TIER_THRESHOLDS.hotMaxAgeHours * H) return 'hot';
  if (ageMs < TIER_THRESHOLDS.warmMaxAgeDays * D) return 'warm';
  if (ageMs < TIER_THRESHOLDS.coolMaxAgeDays * D) return 'cool';
  return 'cold';
}

/** Minimum gap between checks for a tier, in ms. */
export function recheckIntervalMs(tier: Tier): number {
  switch (tier) {
    case 'launch': return 0;
    case 'hot': return TIER_THRESHOLDS.hotRecheckMinutes * 60_000;
    case 'warm': return TIER_THRESHOLDS.warmRecheckHours * H;
    case 'cool': return TIER_THRESHOLDS.coolRecheckDays * D;
    case 'cold': return TIER_THRESHOLDS.coldRecheckDays * D;
  }
}

/** The tier this video is due under right now, or null if it was checked recently enough. */
export function dueTier(
  publishedAt: Date | string | null | undefined,
  lastChecked: Date | string | null | undefined,
  now: Date = new Date()
): Tier | null {
  const tier = tierOf(publishedAt, now);
  if (!lastChecked) return tier; // never captured
  const since = now.getTime() - new Date(lastChecked).getTime();
  return since >= recheckIntervalMs(tier) ? tier : null;
}

export function isLongTail(tier: Tier): boolean {
  return LONG_TAIL_TIERS.includes(tier);
}

/** True on the first LaunchAgent slot of the hour. */
export function isLongTailRun(now: Date = new Date()): boolean {
  return now.getMinutes() < LONG_TAIL_RUN_MINUTE_WINDOW;
}

// Shorts even when is_short is unset: hqdefault of a <=62s upload is not packaging we track.
export const SHORT_DURATION_RE = /^PT(([0-5]?[0-9])S|1M([0-2]S)?)$/;

/** Same rule as the SQL below — a video the watcher is allowed to fetch at all, in ANY tier. */
export function isEligible(v: { duration?: string | null; is_short?: boolean | null; shorts_checked_at?: string | Date | null }): boolean {
  return isLongform(v);                    // live / upcoming excluded too: hqdefault is a feed frame
}

// Shared eligibility: no Shorts, no live/upcoming (hqdefault is a feed frame there, not packaging).
const ELIGIBLE = longformSql('v');

const LATEST = `with latest as (
     select distinct on (video_id) video_id, last_checked
     from thumbnail_versions order by video_id, version desc
   )`;

/** launch + hot + warm: the 30-day window, unchanged from the original watcher. $1 = limit. */
export const HOT_TARGETS_SQL = `${LATEST}
   select v.id from videos v
   left join latest l on l.video_id = v.id
   where v.published_at > now() - interval '30 days'
     and ${ELIGIBLE}
     and (
       v.published_at > now() - interval '6 hours'
       or (v.published_at > now() - interval '72 hours'
           and (l.video_id is null or l.last_checked < now() - interval '25 minutes'))
       or l.video_id is null
       or l.last_checked < now() - interval '23 hours'
     )
   order by v.published_at desc
   limit $1`;

/** cool + cold: everything older than 30 days, weekly / monthly, hard-capped. $1 = limit.
 * Shape matters: the LATERAL (not a materialized `latest` CTE) lets Postgres walk
 * idx_videos_longtail_watch backwards from the 30-day boundary and stop as soon as the
 * LIMIT is filled, instead of seq-scanning ~560K rows every run. */
export const LONG_TAIL_TARGETS_SQL = `select v.id from videos v
   left join lateral (
     select t.last_checked from thumbnail_versions t
     where t.video_id = v.id order by t.version desc limit 1
   ) l on true
   where v.published_at <= now() - interval '30 days'
     and ${ELIGIBLE}
     and (
       l.last_checked is null
       or (v.published_at > now() - interval '90 days' and l.last_checked < now() - interval '7 days')
       or (v.published_at <= now() - interval '90 days' and l.last_checked < now() - interval '30 days')
     )
   order by v.published_at desc
   limit $1`;

/** Tier counts for --dry, cheap: one grouped pass, no per-video work. */
export const TIER_COUNTS_SQL = `${LATEST}
   select case
            when v.published_at > now() - interval '6 hours' then 'launch'
            when v.published_at > now() - interval '72 hours' then 'hot'
            when v.published_at > now() - interval '30 days' then 'warm'
            when v.published_at > now() - interval '90 days' then 'cool'
            else 'cold'
          end as tier,
          count(*)::int as total,
          count(*) filter (where
            v.published_at > now() - interval '6 hours'
            or (v.published_at > now() - interval '72 hours'
                and (l.video_id is null or l.last_checked < now() - interval '25 minutes'))
            or (v.published_at > now() - interval '30 days'
                and (l.video_id is null or l.last_checked < now() - interval '23 hours'))
            or (v.published_at <= now() - interval '30 days' and v.published_at > now() - interval '90 days'
                and (l.video_id is null or l.last_checked < now() - interval '7 days'))
            or (v.published_at <= now() - interval '90 days'
                and (l.video_id is null or l.last_checked < now() - interval '30 days'))
          )::int as due
   from videos v
   left join latest l on l.video_id = v.id
   where ${ELIGIBLE}
   group by 1`;
