// Pacing and planning for owner-analytics backfills.
//
// The YouTube Analytics API allows 720 queries/minute and 100,000/day for the whole project,
// shared by every connected channel. A free signup spike would otherwise fire a full history
// backfill per channel at once and trip the per-minute ceiling, so onboarding runs through a
// queue drained at a deliberate rate. Both ceilings are held below the real limit to leave
// room for the nightly incremental sync and any ad-hoc work.
//
// Pure: no network, no database.

/** Real ceilings are 720/min and 100,000/day; we stay under both. */
export const QUERIES_PER_MINUTE = 400;
export const DAILY_QUERY_BUDGET = 60_000;

/** The report row cap; a query returning this many rows has silently truncated. */
export const REPORT_ROW_CAP = 10_000;

const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Accepts what the database actually hands back. `pg` returns `date` columns as Date objects,
 * not strings, and interpolating one into `${v}T00:00:00Z` yields an invalid date that
 * silently plans zero windows — which reads as "already finished".
 */
export function toIsoDate(value: string | Date): string {
  if (value instanceof Date) return iso(value);
  return String(value).slice(0, 10);
}

/** Inclusive date windows from `first` to `last`, oldest first. */
export function planWindows(first: string | Date, last: string | Date, windowDays: number): { from: string; to: string }[] {
  const start = new Date(`${toIsoDate(first)}T00:00:00Z`).getTime();
  const end = new Date(`${toIsoDate(last)}T00:00:00Z`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) throw new Error('planWindows: unparseable date');
  if (!(end >= start)) return [];
  const out: { from: string; to: string }[] = [];
  for (let t = start; t <= end; t += windowDays * DAY_MS) {
    const to = Math.min(t + (windowDays - 1) * DAY_MS, end);
    out.push({ from: iso(new Date(t)), to: iso(new Date(to)) });
  }
  return out;
}

/** How many videos fit in one call for a window of `days`, keeping rows under the cap. */
export function videosPerCall(days: number): number {
  return Math.max(1, Math.min(200, Math.floor((REPORT_ROW_CAP * 0.9) / (days + 1))));
}

/** Queries needed to cover one window for a channel with `videoCount` videos. */
export function estimateQueries(videoCount: number, windowDays: number): number {
  return Math.max(1, Math.ceil(videoCount / videosPerCall(windowDays)));
}

/**
 * Token bucket over a rolling minute, plus a hard daily cap. `waitMs` returns how long to
 * sleep before spending `n` queries; it records the spend either way, so a caller that
 * honours the delay stays inside both ceilings.
 */
export class Pacer {
  private spentThisMinute = 0;
  private windowStart: number;
  constructor(private now: () => number = Date.now, private spentToday = 0) {
    this.windowStart = now();
  }
  get today(): number { return this.spentToday; }
  exhausted(): boolean { return this.spentToday >= DAILY_QUERY_BUDGET; }

  waitMs(n: number): number {
    const t = this.now();
    if (t - this.windowStart >= 60_000) { this.windowStart = t; this.spentThisMinute = 0; }
    this.spentToday += n;
    if (this.spentThisMinute + n <= QUERIES_PER_MINUTE) { this.spentThisMinute += n; return 0; }
    const wait = 60_000 - (t - this.windowStart);
    this.windowStart = t + wait;
    this.spentThisMinute = n;
    return Math.max(0, wait);
  }
}
