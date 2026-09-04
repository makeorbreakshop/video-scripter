// How far ahead the chart draws — a fact about the video, not a button the reader presses.
//
// The old page had "First 72h / Since publish" chips and a horizon that jumped to the next
// milestone past the video's age (30, 60, 90, 180, 365). Both made the reader choose a frame
// before they could read anything. There is one continuous view now, and its right edge comes
// from the age: roughly three times as far ahead as the video has already lived, which keeps
// the measured part of the line about a third of the plot at every age, then rounded to a span
// a reader already has a word for.
//
// Pure, so the table below is the specification and lib/app/chart-horizon.test.ts is the proof.

/**
 * Spans a reader has a word for. The horizon is always one of these.
 *
 * Correction of 2026-09-04: the list used to start at 3 DAYS, which made the chart unreadable
 * for exactly the video a creator opens it fastest for. Adam Savage's Tested kUcMWnhDF4U was an
 * hour old with seven readings climbing 216 → 1,446 views in 52 minutes; drawn against a 3-day
 * horizon the whole measured record was the leftmost 1.4% of the plot and the y-axis was set by
 * the channel's typical line at day 3 (148K), so the video's own data was a flat smear on the
 * floor. Six hours is the new floor, and the first three ticks are sub-day.
 */
export const HORIZON_TICKS: readonly number[] = [0.25, 0.5, 1, 3, 7, 14, 30, 60, 90, 180, 365];

/** Three times the age: enough forecast to be worth reading, never so much that today is a dot. */
export const HORIZON_MULTIPLE = 3;

/**
 * The last day drawn, for a video of this age.
 *
 * `clamp(3 * ageDays, 0.25, 365)` rounded to the NEAREST tick, so a one-hour video shows six
 * hours, a three-hour video twelve, a six-hour video a day, an 18-hour video 3 days, a five-day
 * video 14, a twelve-day video 30, a two-month video 180, and anything older a year.
 * Monotone non-decreasing in age — the frame never shrinks under a reader as a video ages.
 * A tie rounds UP (3h wants 9h, which is exactly between 6h and 12h): the reader loses nothing
 * by a little more room ahead, and loses the shape of the launch by a little less.
 *
 * This is the FORECAST horizon only. A video older than a year has measurements past it, and
 * the caller (lib/app/video-page.ts) widens the domain to cover them: the chart never cuts off
 * something we actually counted.
 */
export function horizonFor(ageDays: number): number {
  // NaN is a missing age (treat as brand new); Infinity is simply very old, and clamps.
  const age = Number.isNaN(ageDays) ? 0 : Math.max(ageDays ?? 0, 0);
  const first = HORIZON_TICKS[0], last = HORIZON_TICKS[HORIZON_TICKS.length - 1];
  const target = Math.min(Math.max(HORIZON_MULTIPLE * age, first), last);
  let best = first;
  for (const t of HORIZON_TICKS) if (Math.abs(t - target) <= Math.abs(best - target)) best = t;
  return best;
}
