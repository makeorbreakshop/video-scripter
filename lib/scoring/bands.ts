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
  q25: number[];
  q50: number[];
  q75: number[];
  q90: number[];
  n: number[];
  fittedAt?: string;
}

export const QUANTILE_KEYS = ['q10', 'q25', 'q50', 'q75', 'q90'] as const;
export type QuantileKey = (typeof QUANTILE_KEYS)[number];

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
  const q10: number[] = [], q25: number[] = [], q50: number[] = [], q75: number[] = [], q90: number[] = [], n: number[] = [];
  for (let i = 0; i < ages.length; i++) {
    const rs = rows.filter((r) => r.age === ages[i] && Number.isFinite(r.resid)).map((r) => r.resid);
    n.push(rs.length);
    if (rs.length < minRows) {
      // Thin: carry the previous bucket forward (or nothing at all for the first).
      q10.push(q10[i - 1] ?? 0); q25.push(q25[i - 1] ?? 0); q50.push(q50[i - 1] ?? 0);
      q75.push(q75[i - 1] ?? 0); q90.push(q90[i - 1] ?? 0);
      continue;
    }
    q10.push(Math.min(quantile(rs, 0.1)!, 0));
    q25.push(Math.min(quantile(rs, 0.25)!, 0));
    q50.push(quantile(rs, 0.5)!);
    q75.push(Math.max(quantile(rs, 0.75)!, 0));
    q90.push(Math.max(quantile(rs, 0.9)!, 0));
  }
  // Width monotone non-increasing in age: walk forward, shrinking anything that widened.
  const width = (i: number) => Math.exp(q90[i]) - Math.exp(q10[i]);
  for (let i = 1; i < ages.length; i++) {
    let guard = 0;
    while (width(i) > width(i - 1) + 1e-12 && guard++ < 200) {
      const k = width(i - 1) / width(i);
      for (const arr of [q10, q25, q75, q90]) arr[i] = Math.log(1 + (Math.exp(arr[i]) - 1) * k);
    }
  }
  return { ages: [...ages], q10, q25, q50, q75, q90, n, fittedAt: new Date().toISOString() };
}

/** Precision weight on the channel's own MEDIAN: half the corpus's at n = SHRINK_K. */
export const SHRINK_K = 8;

/** The quantile each key estimates, for the variance weighting below. */
const P_OF: Record<QuantileKey, number> = { q10: 0.1, q25: 0.25, q50: 0.5, q75: 0.75, q90: 0.9 };

/**
 * Shrinkage constant per quantile. The asymptotic variance of a sample p-quantile goes as
 * p(1-p), so the 90th percentile of five videos is nothing but their maximum — an estimate
 * with several times the variance of their median, and biased inward besides. Weighting every
 * quantile at w = n/(n+8) therefore trusts exactly the numbers that deserve it least: measured
 * on held-out videos, that gave a "4 in 5 land here" band that actually covered 38.7%.
 *
 * k is scaled by 0.25 / p(1-p), leaving the median at SHRINK_K and pulling the tails ~2.8x
 * harder toward the corpus.
 */
export function shrinkKFor(key: QuantileKey, k = SHRINK_K): number {
  const p = P_OF[key];
  return (k * 0.25) / (p * (1 - p));
}

/**
 * Blend a channel's own quantiles toward the corpus's, weighted by how much of the channel we
 * have actually seen: w = n / (n + k), per age bucket, with k per quantile (see shrinkKFor —
 * a tail needs far more data than a median). A channel with no videos in a bucket gets the
 * corpus answer exactly; one with hundreds gets its own. Without this, a channel with four
 * day-30 videos would have its 90th percentile set by its single worst result — a narrower
 * band that is narrower for no reason.
 */
/**
 * A channel's own quantiles are ignored in a bucket with fewer than this many of its videos.
 *
 * Measured, not chosen: scripts/check-band-calibration.ts on 500 held-out videos found that
 * per-channel bands NEVER beat the corpus, at any shrinkage. On the subset of videos whose
 * channels have their own table, held-out coverage of the "4 in 5" band was 55.0% at the
 * specified shrinkage, 64.8% at 3x, 70.0% at 10x, 73.1% at 30x — rising toward, and never
 * reaching, the 74.6% the corpus fit gets on those same videos. The cause is visible in the
 * data: the median channel has 0-11 day-30 videos in a bucket, and a 90th percentile of five
 * videos is just their maximum.
 *
 * Sweeping the gate settles it. Held-out coverage of the "4 in 5" band on the channel subset,
 * against the number of (channel, bucket) cells that clear the gate:
 *     n>=30  -> 50 cells, 69.2%      n>=60  -> 5 cells, 72.9%
 *     n>=100 ->  2 cells, 73.5%      n>=200 -> 0 cells, 74.7%
 * Monotone: every cell that switches to the channel costs coverage. At 200 nothing qualifies
 * today, so in practice this ships as the corpus fit for every video — which is the honest
 * reading of the measurement, not a way of hiding the feature. The machinery stays because it
 * is correct and tested, and a cell turns itself on when a channel really has 200 day-30
 * videos at one age.
 */
export const MIN_CHANNEL_BUCKET_N = 200;

export function shrinkToGlobal(
  channel: BandTable,
  global: BandTable,
  k = SHRINK_K,
  minBucketN = MIN_CHANNEL_BUCKET_N
): BandTable {
  if (channel.ages.length !== global.ages.length || channel.ages.some((a, i) => a !== global.ages[i])) {
    throw new Error('shrinkToGlobal: channel and global ages must match');
  }
  const out: BandTable = { ages: [...global.ages], q10: [], q25: [], q50: [], q75: [], q90: [], n: [...channel.n], fittedAt: channel.fittedAt };
  for (let i = 0; i < global.ages.length; i++) {
    const raw = Math.max(channel.n[i] ?? 0, 0);
    const n = raw >= minBucketN ? raw : 0;
    for (const key of QUANTILE_KEYS) {
      const w = n / (n + shrinkKFor(key, k));
      out[key].push(w * channel[key][i] + (1 - w) * global[key][i]);
    }
    // The blend of two ordered, forecast-containing sets is ordered and forecast-containing,
    // but float error can tie them; make the invariant explicit rather than nearly true.
    out.q10[i] = Math.min(out.q10[i], out.q25[i], 0);
    out.q25[i] = Math.min(out.q25[i], out.q50[i], 0);
    out.q90[i] = Math.max(out.q90[i], out.q75[i], 0);
    out.q75[i] = Math.max(out.q75[i], out.q50[i], 0);
  }
  return out;
}

// ---------------------------------------------------------- trajectory ------
//
// The band above asks "how wrong is a forecast made at day 4?" across the whole corpus. But a
// video we have watched sit exactly on its channel's curve for ten days is a different case
// from one we glimpsed once at day 4, and the corpus answer covers both. So the fitted width
// is scaled by what this video's own record says.

/**
 * Deterministic held-out split, so a band can be checked against videos it was not fitted on.
 * A 32-bit FNV-1a of the id mapped to [0,1): the same video is always on the same side, and
 * widening the share only ever adds videos, so a bigger holdout is a superset of a smaller one.
 */
export function heldOut(videoId: string, share = 1 / 16): boolean {
  if (!(share > 0)) return false;
  if (share >= 1) return true;
  let h = 0x811c9dc5;
  for (let i = 0; i < videoId.length; i++) {
    h ^= videoId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h / 0x100000000 < share;
}

/** channel_forecast_bands rows -> a BandTable, ordered by bucket. Null when the channel has none. */
export function tableFromRows(
  rows: Array<{ age_bucket: number | string; n: number | string; q10: any; q25: any; q50: any; q75: any; q90: any }>
): BandTable | null {
  if (!rows?.length) return null;
  const sorted = [...rows].sort((a, b) => Number(a.age_bucket) - Number(b.age_bucket));
  return {
    ages: sorted.map((r) => Number(r.age_bucket)),
    q10: sorted.map((r) => Number(r.q10)),
    q25: sorted.map((r) => Number(r.q25)),
    q50: sorted.map((r) => Number(r.q50)),
    q75: sorted.map((r) => Number(r.q75)),
    q90: sorted.map((r) => Number(r.q90)),
    n: sorted.map((r) => Number(r.n)),
  };
}

/** A measurement and the channel's typical curve at the same age. */
export interface TrajectoryPoint { day: number; views: number; expected: number }

/**
 * How far the band may be tightened by a long, clean record.
 *
 * Measured, not chosen. Sweeping the floor against held-out coverage of the "4 in 5" band
 * (scripts/check-band-calibration.ts, 500 videos, corpus bands):
 *     1.00 -> 82.1%   0.95 -> 81.4%   0.90 -> 80.9%   0.85 -> 79.6%
 *     0.80 -> 79.0%   0.70 -> 77.4%   0.50 -> 72.3%
 * The review asked for 0.5; that costs ten points of coverage and would put a band labelled
 * "4 in 5 land here" at 72%. 0.85 is the most tightening the data supports while the label
 * stays true.
 */
export const BAND_FACTOR_FLOOR = 0.85;
/** Log-residual RMS at which the fit-quality term has decayed to 1/e. */
export const TRAJECTORY_RMS_SCALE = 0.15;
/** Measured span (days) at which the span term saturates. */
export const TRAJECTORY_SPAN_FULL = 7;

const lgd = (d: number) => Math.log(Math.max(d, 0) + 1);

/**
 * Fit the channel's curve through ALL the measurements: one free parameter, the log scale, so
 * this is a weighted mean of log(views / expected). Weights are the trapezoid width in
 * log(day+1) each point stands for, NOT one per point — a video with one snapshot on day 3 and
 * twenty launch samples inside a single hour of day 5 would otherwise be fitted almost entirely
 * to that hour. `rms` is the weighted dispersion around the fit.
 */
export function fitTrajectory(points: TrajectoryPoint[]): { logScale: number; rms: number; spanDays: number; n: number } {
  const p = points
    .filter((x) => x.views > 0 && x.expected > 0 && Number.isFinite(x.day) && x.day >= 0)
    .sort((a, b) => a.day - b.day);
  if (!p.length) return { logScale: 0, rms: 0, spanDays: 0, n: 0 };
  const spanDays = p[p.length - 1].day - p[0].day;
  if (p.length === 1) return { logScale: Math.log(p[0].views / p[0].expected), rms: 0, spanDays: 0, n: 1 };
  const r = p.map((x) => Math.log(x.views / x.expected));
  const w = p.map((_, i) => {
    const prev = i === 0 ? p[0].day : p[i - 1].day;
    const next = i === p.length - 1 ? p[p.length - 1].day : p[i + 1].day;
    return Math.max((lgd(next) - lgd(prev)) / 2, 1e-9);
  });
  const sw = w.reduce((a, b) => a + b, 0);
  const logScale = r.reduce((a, x, i) => a + w[i] * x, 0) / sw;
  const varr = r.reduce((a, x, i) => a + w[i] * (x - logScale) ** 2, 0) / sw;
  return { logScale, rms: Math.sqrt(Math.max(varr, 0)), spanDays, n: p.length };
}

/**
 * Multiplier on the band's log width, in [BAND_FACTOR_FLOOR, 1]. It falls as the fit residual
 * shrinks and as the measured span grows, and is exactly 1 for a single measurement — one point
 * is a scale, not a trajectory, and says nothing about how predictable this video is.
 */
export function trajectoryFactor(points: TrajectoryPoint[]): number {
  const f = fitTrajectory(points);
  if (f.n < 2 || !(f.spanDays > 0)) return 1;
  const quality = Math.exp(-f.rms / TRAJECTORY_RMS_SCALE);       // 1 at a perfect fit
  const span = Math.min(Math.max(f.spanDays / TRAJECTORY_SPAN_FULL, 0), 1);
  return 1 - (1 - BAND_FACTOR_FLOOR) * quality * span;
}

/** The 10th/90th log-residual at an arbitrary age: log-linear between buckets, clamped outside. */
export type Quantiles = Record<QuantileKey, number>;
const pick = (t: BandTable, i: number): Quantiles =>
  ({ q10: t.q10[i], q25: t.q25[i], q50: t.q50[i], q75: t.q75[i], q90: t.q90[i] });

export function bandAt(t: BandTable | null | undefined, age: number): Quantiles {
  const zero: Quantiles = { q10: 0, q25: 0, q50: 0, q75: 0, q90: 0 };
  if (!t || !t.ages?.length) return zero;
  const last = t.ages.length - 1;
  if (!(age > t.ages[0])) return pick(t, 0);
  if (age >= t.ages[last]) return pick(t, last);
  for (let i = 1; i <= last; i++) {
    if (age <= t.ages[i]) {
      const x0 = Math.log(t.ages[i - 1]), x1 = Math.log(t.ages[i]), x = Math.log(age);
      const f = (x - x0) / (x1 - x0);
      const a = pick(t, i - 1), b = pick(t, i);
      const out = { ...zero };
      for (const k of QUANTILE_KEYS) out[k] = a[k] + (b[k] - a[k]) * f;
      return out;
    }
  }
  return pick(t, last);
}

const lg = (d: number) => Math.log(Math.max(d, 0) + 1);

/**
 * The band around a forecast value. It opens from nothing at the last measurement — the video
 * IS there, we counted it — to the full fitted 10-90 range at day 30, and stays there after.
 * Null when there is no fitted table: better no band than an invented one.
 */
export interface ForecastBand {
  /** q25..q75 — half of videos land in here. Drawn as the solid band. */
  inner: [number, number];
  /** q10..q90 — four in five. Drawn as a fainter outer edge. */
  outer: [number, number];
}

export function forecastBand(
  views: number,
  day: number,
  lastMeasuredDay: number,
  table: BandTable | null | undefined,
  factor = 1
): ForecastBand | null {
  if (!table || !table.ages?.length) return null;
  const q = bandAt(table, lastMeasuredDay);
  const span = lg(30) - lg(lastMeasuredDay);
  const t = span > 0 ? Math.min(Math.max((lg(day) - lg(lastMeasuredDay)) / span, 0), 1) : (day > lastMeasuredDay ? 1 : 0);
  const w = t * Math.min(Math.max(factor, 0), 1);
  return {
    inner: [views * Math.exp(w * q.q25), views * Math.exp(w * q.q75)],
    outer: [views * Math.exp(w * q.q10), views * Math.exp(w * q.q90)],
  };
}

/**
 * The fit of 2026-09-03: long-form videos with a real day-27..33 snapshot, 18-month window,
 * with a deterministic 1/16 of videos HELD OUT (bands.heldOut) so calibration can be measured
 * on videos the fit never saw. 21,110 videos / 26,500 residuals. Used when score_params carries
 * no `bands` key, and as the fixture the sanity test in bands.test.ts reads.
 *
 * Read it as: a video last measured on day 4 lands between 0.78x and 1.83x of its day-30
 * forecast four times in five (q10..q90), and between 0.87x and 1.26x half the time
 * (q25..q75). The outer spread is 1.047 — WIDER than the "under 1.0" the first review asked
 * for, and it is what the corpus says. The q50 column is ~0 from day 2 on, so the model is
 * unbiased past the first day; at day 0.5 and day 1 it under-forecasts by 10-22%, which is a
 * scoring finding, not a drawing one.
 */
export const FITTED_BANDS_2026_09_03: BandTable = {
  ages: [0.5, 1, 2, 3, 4, 5, 7, 10, 14, 21],
  q10: [-0.3505, -0.4162, -0.3879, -0.3076, -0.2449, -0.2094, -0.1638, -0.1192, -0.0780, -0.0329],
  q25: [-0.1612, -0.2078, -0.2383, -0.1790, -0.1433, -0.1209, -0.1001, -0.0739, -0.0499, -0.0224],
  q50: [0.2016, 0.0914, -0.0029, 0.0029, 0.0049, 0.0094, 0.0052, 0.0016, 0.0008, 0.0006],
  q75: [0.7451, 0.5631, 0.3249, 0.2767, 0.2278, 0.2090, 0.1580, 0.1208, 0.0863, 0.0417],
  q90: [1.3270, 1.0729, 0.8237, 0.7578, 0.6040, 0.5613, 0.4195, 0.3133, 0.2221, 0.1100],
  n: [100, 719, 1146, 1307, 1829, 2169, 2783, 3595, 4696, 8156],
  fittedAt: '2026-09-03',
};
