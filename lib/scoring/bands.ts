// How wrong the day-30 forecast has actually been, by the age of the last measurement.
//
// The chart's forecast band used to be a constant I picked by eye
// (chart-series FORECAST_SIGMA_PER_LOGDAY = 0.30, i.e. sigma = 0.30 * (ln(d+1) - ln(a+1))),
// which put a 3.00x spread on a video last measured on day 4 — not a claim the model can
// support either way. This replaces it with the corpus's own answer: for videos that have both
// an observation near age A and a real day-27..33 snapshot,
//
//     resid = log( actual day-30 views / the day-30 forecast the model would have made at A )
//
// and the band is the 10th..90th percentile of that residual, per age bucket. Fitted by
// scripts/fit-forecast-bands.ts into score_params.params.bands; the page reads the table.

export interface BandTable {
  ages: number[];
  q10: number[];
  q50: number[];
  q90: number[];
  n: number[];
  fittedAt?: string;
}

/** Ages (days) the band is fitted at. Denser early, where the forecast is doing the most work. */
export const BAND_AGES = [0.5, 1, 2, 3, 4, 5, 7, 10, 14, 21] as const;

/** Linear-interpolated quantile of an unsorted sample; null when empty. */
export function quantile(xs: number[], p: number): number | null {
  const a = xs.filter((x) => Number.isFinite(x)).sort((u, v) => u - v);
  if (!a.length) return null;
  const i = (a.length - 1) * Math.min(Math.max(p, 0), 1);
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (i - lo);
}

export interface BandRow { age: number; resid: number }

/**
 * Percentiles per age bucket, with two properties forced on the result:
 *   - q10 <= 0 <= q90, so the band always contains the line it is drawn around. A bucket whose
 *     residuals are all on one side means the model is biased at that age; that is a scoring
 *     problem, and drawing a band that excludes its own forecast would only hide it.
 *   - the width never grows with age. A later measurement leaves less to guess, so a bucket
 *     that came out wider than a younger one is sampling noise, not knowledge.
 * A bucket with fewer than `minRows` observations carries the previous one forward.
 */
export function fitBands(rows: BandRow[], ages: readonly number[] = BAND_AGES, minRows = 50): BandTable {
  const q10: number[] = [], q50: number[] = [], q90: number[] = [], n: number[] = [];
  for (let i = 0; i < ages.length; i++) {
    const rs = rows.filter((r) => r.age === ages[i] && Number.isFinite(r.resid)).map((r) => r.resid);
    n.push(rs.length);
    if (rs.length < minRows) {
      // Thin: carry the previous bucket forward (or nothing at all for the first).
      q10.push(q10[i - 1] ?? 0); q50.push(q50[i - 1] ?? 0); q90.push(q90[i - 1] ?? 0);
      continue;
    }
    q10.push(Math.min(quantile(rs, 0.1)!, 0));
    q50.push(quantile(rs, 0.5)!);
    q90.push(Math.max(quantile(rs, 0.9)!, 0));
  }
  // Width monotone non-increasing in age: walk forward, shrinking anything that widened.
  const width = (i: number) => Math.exp(q90[i]) - Math.exp(q10[i]);
  for (let i = 1; i < ages.length; i++) {
    let guard = 0;
    while (width(i) > width(i - 1) + 1e-12 && guard++ < 200) {
      const k = width(i - 1) / width(i);
      q10[i] = Math.log(1 + (Math.exp(q10[i]) - 1) * k);
      q90[i] = Math.log(1 + (Math.exp(q90[i]) - 1) * k);
    }
  }
  return { ages: [...ages], q10, q50, q90, n, fittedAt: new Date().toISOString() };
}

/** The 10th/90th log-residual at an arbitrary age: log-linear between buckets, clamped outside. */
export function bandAt(t: BandTable | null | undefined, age: number): { q10: number; q90: number } {
  if (!t || !t.ages?.length) return { q10: 0, q90: 0 };
  const last = t.ages.length - 1;
  if (!(age > t.ages[0])) return { q10: t.q10[0], q90: t.q90[0] };
  if (age >= t.ages[last]) return { q10: t.q10[last], q90: t.q90[last] };
  for (let i = 1; i <= last; i++) {
    if (age <= t.ages[i]) {
      const x0 = Math.log(t.ages[i - 1]), x1 = Math.log(t.ages[i]), x = Math.log(age);
      const f = (x - x0) / (x1 - x0);
      return { q10: t.q10[i - 1] + (t.q10[i] - t.q10[i - 1]) * f, q90: t.q90[i - 1] + (t.q90[i] - t.q90[i - 1]) * f };
    }
  }
  return { q10: t.q10[last], q90: t.q90[last] };
}

const lg = (d: number) => Math.log(Math.max(d, 0) + 1);

/**
 * The band around a forecast value. It opens from nothing at the last measurement — the video
 * IS there, we counted it — to the full fitted 10-90 range at day 30, and stays there after.
 * Null when there is no fitted table: better no band than an invented one.
 */
export function forecastBand(
  views: number,
  day: number,
  lastMeasuredDay: number,
  table: BandTable | null | undefined
): [number, number] | null {
  if (!table || !table.ages?.length) return null;
  const { q10, q90 } = bandAt(table, lastMeasuredDay);
  const span = lg(30) - lg(lastMeasuredDay);
  const w = span > 0 ? Math.min(Math.max((lg(day) - lg(lastMeasuredDay)) / span, 0), 1) : (day > lastMeasuredDay ? 1 : 0);
  return [views * Math.exp(w * q10), views * Math.exp(w * q90)];
}

/**
 * The fit of 2026-09-03: 22,356 long-form videos with a real day-27..33 snapshot, 27,917
 * (video, age) residuals, 18-month window. Used when score_params carries no `bands` key yet,
 * and as the fixture the sanity test in bands.test.ts reads.
 *
 * Read it as: a video last measured on day 4 lands between 0.78x and 1.82x of its day-30
 * forecast, 80% of the time. That is a 1.035 spread — WIDER than the "under 1.0" the review
 * asked for, and it is what the corpus says; the day-30 forecast from day 4 is genuinely not
 * better than that. It is still a third of the 3.00x flat band it replaces, and it tightens
 * to 0.148 by day 21. The q50 column is ~0 from day 2 on, so the model is unbiased past the
 * first day; at day 0.5 and day 1 it under-forecasts by 8-19%, which is a scoring finding,
 * not a drawing one.
 */
export const FITTED_BANDS_2026_09_03: BandTable = {
  ages: [0.5, 1, 2, 3, 4, 5, 7, 10, 14, 21],
  q10: [-0.4745, -0.4244, -0.3922, -0.3075, -0.2460, -0.2110, -0.1640, -0.1197, -0.0780, -0.0327],
  q50: [0.1889, 0.0864, -0.0038, -0.0019, 0.0028, 0.0079, 0.0048, 0.0011, 0.0013, 0.0008],
  q90: [1.3175, 1.0562, 0.8250, 0.7558, 0.5974, 0.5435, 0.4155, 0.3069, 0.2162, 0.1094],
  n: [107, 741, 1205, 1387, 1945, 2295, 2951, 3793, 4918, 8575],
  fittedAt: '2026-09-03',
};
