// The one definition of "a long-form video" for every query that reads the corpus: channel
// baselines, scoring targets, the feed, channel pages, launch tracking, backtests.
//
// YouTube Shorts run up to 3 minutes (since late 2024). Ingest historically only flagged clips
// of 62s or less, so tens of thousands of 63-180s Shorts sat in `videos` with is_short=false and
// were averaged into channel baselines as if they were shows. Duration alone cannot separate a
// 2-minute Short from a 2-minute trailer, so scripts/verify-shorts.ts asks YouTube (the
// /shorts/<id> URL answers 200 for a Short and redirects otherwise, zero API quota) and stamps
// `shorts_checked_at`. Until a <=180s video has been checked it is treated as a Short: the cost
// of briefly hiding a rare short horizontal clip is far below the cost of a polluted baseline.

export const SHORT_MAX_SECONDS = 180;

/** ISO-8601 duration -> seconds; null for live ('P0D'), missing, or unparsable values. */
export function durationSeconds(dur: string | null | undefined): number | null {
  if (!dur || dur === 'P0D') return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(dur);
  if (!m) return null;
  const [, d, h, mi, s] = m;
  return (Number(d ?? 0) * 86400) + (Number(h ?? 0) * 3600) + (Number(mi ?? 0) * 60) + Number(s ?? 0);
}

/**
 * SQL predicate selecting long-form, non-live videos from `videos` aliased as `a`.
 *   - not flagged a Short
 *   - not a live/premiere placeholder (duration 'P0D')
 *   - not an unverified clip of SHORT_MAX_SECONDS or less
 * Parsable only for 'PT...' durations; anything with a day component is hours long anyway.
 */
export function longformSql(a = 'v'): string {
  return `(coalesce(${a}.is_short, false) = false
    and coalesce(${a}.duration, '') <> 'P0D'
    and not (${a}.shorts_checked_at is null
             and ${a}.duration ~ '^PT[0-9HMS]+$'
             and extract(epoch from ${a}.duration::interval) <= ${SHORT_MAX_SECONDS}))`;
}

/** Same rule in TypeScript, for rows already in hand. */
export function isLongform(v: { is_short?: boolean | null; duration?: string | null; shorts_checked_at?: string | Date | null }): boolean {
  if (v.is_short) return false;
  if (!v.duration || v.duration === 'P0D') return false;
  const secs = durationSeconds(v.duration);
  if (secs != null && secs <= SHORT_MAX_SECONDS && !v.shorts_checked_at) return false;
  return true;
}
