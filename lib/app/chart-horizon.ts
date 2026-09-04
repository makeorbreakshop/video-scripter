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

/** Spans a reader has a word for. The horizon is always one of these. */
export const HORIZON_TICKS: readonly number[] = [3, 7, 14, 30, 60, 90, 180, 365];

/** Three times the age: enough forecast to be worth reading, never so much that today is a dot. */
export const HORIZON_MULTIPLE = 3;

/**
 * The last day drawn, for a video of this age.
 *
 * `clamp(3 * ageDays, 3, 365)` rounded to the NEAREST tick, so an 18-hour video shows 3 days,
 * a five-day video 14, a twelve-day video 30, a two-month video 180, and anything older a year.
 * Monotone non-decreasing in age — the frame never shrinks under a reader as a video ages.
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
  for (const t of HORIZON_TICKS) if (Math.abs(t - target) < Math.abs(best - target)) best = t;
  return best;
}
