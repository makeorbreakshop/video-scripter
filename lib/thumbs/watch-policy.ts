// Thumbnail watch policy (2026-09-02, retiered 2026-09-03). Pure functions + SQL text, no I/O.
//
// Two cadence ladders live here at once while the two-lane watcher is on trial
// (docs/plans/2026-09-03-two-lane-watcher.md, "Subset test"):
//
//   subset (new)                       legacy (what everything else keeps during the test)
//     launch  <24h   every run           launch  <6h    every run
//     hot     1-3d   15 min              hot     6-72h  ~25 min
//     warm    3-14d  30 min              warm    3-30d  23 h
//     steady  14-30d 2 h                 cool    30-90d 7 d
//     cool    30-90d daily               cold    >90d   30 d
//     cold    >90d   weekly
//
// A video runs on the new ladder when its channel is in watch_subset; with the subset gate off
// (rollout) every video does. Every non-Short, non-live video qualifies.
//
// Cost rule, unchanged: the hot query (everything under 30 days) is selected FIRST and only
// touches the 30-day slice via idx_videos_published_desc, so long-tail work can never crowd it
// out of the per-run cap. The long-tail query is separately capped (LONG_TAIL_MAX_PER_RUN) and
// runs once an hour (isLongTailRun) because its anti-join covers ~850K rows and this DB has had
// IO incidents.
//
// "Due now" needs no special column: the RSS poller and the WebSub wake-up stamp the latest
// thumbnail_versions.last_checked to 'epoch', which is older than every recheck window in every
// tier, so the very next run picks the video up.
import { isLongform, longformSql } from '../scoring/longform';

export type Tier = 'launch' | 'hot' | 'warm' | 'steady' | 'cool' | 'cold';
export type Cadence = 'subset' | 'legacy';

/** One rung: everything younger than maxAge (and older than the rung above) rechecks at recheck. */
export interface Rung {
  tier: Tier;
  /** null on the last rung: it catches everything older. */
  maxAge: Interval | null;
  recheck: Interval;
}
export interface Interval { n: number; unit: 'minutes' | 'hours' | 'days' }

const MS: Record<Interval['unit'], number> = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };
export const ms = (i: Interval): number => i.n * MS[i.unit];
export const sql = (i: Interval): string => `interval '${i.n} ${i.unit}'`;

export const LADDERS: Record<Cadence, Rung[]> = {
  subset: [
    { tier: 'launch', maxAge: { n: 24, unit: 'hours' }, recheck: { n: 0, unit: 'minutes' } },
    { tier: 'hot', maxAge: { n: 3, unit: 'days' }, recheck: { n: 15, unit: 'minutes' } },
    { tier: 'warm', maxAge: { n: 14, unit: 'days' }, recheck: { n: 30, unit: 'minutes' } },
    { tier: 'steady', maxAge: { n: 30, unit: 'days' }, recheck: { n: 2, unit: 'hours' } },
    { tier: 'cool', maxAge: { n: 90, unit: 'days' }, recheck: { n: 24, unit: 'hours' } },
    { tier: 'cold', maxAge: null, recheck: { n: 7, unit: 'days' } },
  ],
  legacy: [
    { tier: 'launch', maxAge: { n: 6, unit: 'hours' }, recheck: { n: 0, unit: 'minutes' } },
    { tier: 'hot', maxAge: { n: 72, unit: 'hours' }, recheck: { n: 25, unit: 'minutes' } },
    { tier: 'warm', maxAge: { n: 30, unit: 'days' }, recheck: { n: 23, unit: 'hours' } },
    { tier: 'cool', maxAge: { n: 90, unit: 'days' }, recheck: { n: 7, unit: 'days' } },
    { tier: 'cold', maxAge: null, recheck: { n: 30, unit: 'days' } },
  ],
};

/** Long tail = older than 30 days, in both ladders. The boundary the two SQL queries split on. */
export const LONG_TAIL_AFTER: Interval = { n: 30, unit: 'days' };
export const LONG_TAIL_TIERS: Tier[] = ['cool', 'cold'];
export const LONG_TAIL_MAX_PER_RUN = 4000;
/** Long tail runs once an hour: the LaunchAgent fires every 5 min, so gate on the first slot. */
export const LONG_TAIL_RUN_MINUTE_WINDOW = 5;

/** Age bucket alone — which cadence rung this video belongs to, ignoring when it was last checked. */
export function tierOf(
  publishedAt: Date | string | null | undefined,
  now: Date = new Date(),
  cadence: Cadence = 'subset'
): Tier {
  const ladder = LADDERS[cadence];
  if (!publishedAt) return 'cold';
  const ageMs = now.getTime() - new Date(publishedAt).getTime();
  for (const r of ladder) if (r.maxAge === null || ageMs < ms(r.maxAge)) return r.tier;
  return 'cold';
}

/** Minimum gap between checks for a tier, in ms. */
export function recheckIntervalMs(tier: Tier, cadence: Cadence = 'subset'): number {
  const r = LADDERS[cadence].find((x) => x.tier === tier);
  return r ? ms(r.recheck) : 0;
}

/** The tier this video is due under right now, or null if it was checked recently enough. */
export function dueTier(
  publishedAt: Date | string | null | undefined,
  lastChecked: Date | string | null | undefined,
  now: Date = new Date(),
  cadence: Cadence = 'subset'
): Tier | null {
  const tier = tierOf(publishedAt, now, cadence);
  if (!lastChecked) return tier; // never captured
  const since = now.getTime() - new Date(lastChecked).getTime();
  return since >= recheckIntervalMs(tier, cadence) ? tier : null;
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

// ---------- SQL ----------

// Shared eligibility: no Shorts, no live/upcoming (hqdefault is a feed frame there, not packaging).
const ELIGIBLE = longformSql('v');

const LATEST = `with latest as (
     select distinct on (video_id) video_id, last_checked
     from thumbnail_versions order by video_id, version desc
   )`;

/**
 * Is this video on the new ladder? $1 = "subset gate on?". With the gate off (rollout) every
 * video is; with it on, only videos whose channel is in watch_subset. watch_subset is tiny, so
 * the planner hashes it once per query rather than probing per row.
 */
const ON_NEW_LADDER = `(not $1::boolean or exists (select 1 from watch_subset ws where ws.channel_id = v.channel_id))`;

/**
 * OR-chain of "this video is in rung R and its last check is older than R's recheck window",
 * built from LADDERS so the thresholds and the SQL can never drift apart.
 * `lastChecked` is the expression holding the newest thumbnail_versions.last_checked (null =
 * never captured, always due). `window` restricts to the hot (<30d) or long-tail (>=30d) slice.
 */
function dueSql(
  cadence: Cadence,
  lastChecked: string,
  window: 'hot' | 'long-tail'
): string {
  const parts: string[] = [];
  let lower: Interval | null = null; // the rung above's maxAge — this rung's minimum age
  for (const r of LADDERS[cadence]) {
    const inHot = r.maxAge !== null && ms(r.maxAge) <= ms(LONG_TAIL_AFTER);
    if (window === 'hot' && !inHot) { lower = r.maxAge; continue; }
    if (window === 'long-tail' && inHot) { lower = r.maxAge; continue; }
    const bounds: string[] = [];
    if (r.maxAge) bounds.push(`v.published_at > now() - ${sql(r.maxAge)}`);
    if (lower) bounds.push(`v.published_at <= now() - ${sql(lower)}`);
    const stale = ms(r.recheck) === 0
      ? 'true' // launch: every run, whatever last_checked says
      : `(${lastChecked} is null or ${lastChecked} < now() - ${sql(r.recheck)})`;
    parts.push(`(${[...bounds, stale].join(' and ')})`);
    lower = r.maxAge;
  }
  return parts.join('\n       or ');
}

const dueBoth = (lastChecked: string, window: 'hot' | 'long-tail') =>
  `((${ON_NEW_LADDER} and (${dueSql('subset', lastChecked, window)}))
        or (not ${ON_NEW_LADDER} and (${dueSql('legacy', lastChecked, window)})))`;

/** Everything under 30 days. $1 = subset gate on?, $2 = limit. */
export const HOT_TARGETS_SQL = `${LATEST}
   select v.id from videos v
   left join latest l on l.video_id = v.id
   where v.published_at > now() - ${sql(LONG_TAIL_AFTER)}
     and ${ELIGIBLE}
     and ${dueBoth('l.last_checked', 'hot')}
   order by v.published_at desc
   limit $2`;

/** Everything older than 30 days, hard-capped. $1 = subset gate on?, $2 = limit.
 * Shape matters: the LATERAL (not a materialized `latest` CTE) lets Postgres walk
 * idx_videos_longtail_watch backwards from the 30-day boundary and stop as soon as the
 * LIMIT is filled, instead of seq-scanning ~560K rows every run. */
export const LONG_TAIL_TARGETS_SQL = `select v.id from videos v
   left join lateral (
     select t.last_checked from thumbnail_versions t
     where t.video_id = v.id order by t.version desc limit 1
   ) l on true
   where v.published_at <= now() - ${sql(LONG_TAIL_AFTER)}
     and ${ELIGIBLE}
     and ${dueBoth('l.last_checked', 'long-tail')}
   order by v.published_at desc
   limit $2`;

/** Tier counts for --dry, cheap: one grouped pass, no per-video work. $1 = subset gate on? */
export const TIER_COUNTS_SQL = `${LATEST}
   select case
${LADDERS.subset
  .map((r) => (r.maxAge ? `            when v.published_at > now() - ${sql(r.maxAge)} then '${r.tier}'` : `            else '${r.tier}'`))
  .join('\n')}
          end as tier,
          count(*)::int as total,
          count(*) filter (where ${dueBoth('l.last_checked', 'hot')}
            or ${dueBoth('l.last_checked', 'long-tail')})::int as due
   from videos v
   left join latest l on l.video_id = v.id
   where ${ELIGIBLE}
   group by 1`;

/** Ordered tier names for --dry output. */
export const TIER_ORDER: Tier[] = LADDERS.subset.map((r) => r.tier);
