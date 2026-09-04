// One value per day, from publish to the horizon, with a word for where it came from.
//
// Invariant: every day from publish (day 0) to the horizon has exactly one value, whose kind
// is `measured` where we have a sample, `implied` where we do not and the day is behind the
// last measurement, and `forecast` beyond it. Kind decides styling, never whether a value
// exists — a video whose first sample landed on day 3.4 (RSS found it late) must not draw a
// blank first three days, and the old rule that switched behaviour on `actuals.length <= 3`
// meant a sparse video got an implied path while a well-sampled one got a hole.
//
// The shape everything is drawn along is the channel's own typical curve (lib/admin/video-curve
// expectedAt / the fitted global `mult`), used only as a SHAPE: each segment is re-anchored on
// the real measurements next to it, so the implied path passes exactly through the first
// measurement instead of floating beside it.
import { expectedAt, forecastAt, type Mult, type Longtail, type CurvePoint } from '../admin/video-curve';
import {
  forecastBand, fitTrajectory, trajectoryFactor, FITTED_BANDS_2026_09_03,
  type BandTable, type ForecastBand, type TrajectoryPoint,
} from '../scoring/bands';
import { markObservations } from './observations';

export type SeriesKind = 'measured' | 'implied' | 'forecast';
/**
 * Two nested ranges: `inner` is q25..q75 (half of videos land there), `outer` q10..q90 (four in
 * five). The chart draws the inner solid and the outer as a fainter edge, so the reader sees the
 * likely case without being told the tail does not exist.
 */
export type SeriesPoint = { day: number; views: number; kind: SeriesKind; band?: ForecastBand };

/** A symmetric log range, for the segments whose uncertainty is not a fitted quantile. */
const sym = (v: number, sigma: number): ForecastBand =>
  ({ inner: [v * Math.exp(-sigma / 2), v * Math.exp(sigma / 2)], outer: [v * Math.exp(-sigma), v * Math.exp(sigma)] });

export interface BuildSeriesInput {
  /** The video's real measurements, in any order; days are days since publish. */
  actuals: { day: number; views: number }[];
  baseline: number | null | undefined;
  est30: number | null | undefined;
  mult: Mult;
  longtail?: Longtail | null;
  /** Last day drawn. */
  horizonDay: number;
  /** Age now; only used when there is nothing measured at all. */
  ageDays?: number;
  /**
   * Fitted forecast band: the channel's own table, else score_params.params.bands.
   *
   * Correction of 2026-09-04: `null` used to mean "no band at all", and null is exactly what
   * lib/admin/queries hands over for every video today — score_params carries no `bands` key
   * and most channels have no channel_forecast_bands rows — so no forecast point ever got a
   * band and the ribbons were missing from the chart in BOTH zooms. Nothing to say is not a
   * reason to say nothing: absent or null now falls back to the corpus fit, which is what the
   * band is fitted for. To draw no band, pass a table with no ages.
   */
  bands?: BandTable | null;
}

/** Integer days are drawn one by one up to here; past it the grid goes log-spaced. */
export const DENSE_DAYS = 400;
/** Sub-day grid so the launch window is readable at all (hours 1,2,4,8,12,18). */
const LAUNCH_DAYS = [1 / 24, 2 / 24, 4 / 24, 8 / 24, 12 / 24, 18 / 24];
/**
 * When the whole chart IS the launch window — a video hours old, drawn to a 6h or 12h horizon
 * (lib/app/chart-horizon.ts) — six hourly points are six points, and the forecast between them
 * is drawn as straight segments across an hour of the steepest growth the video will ever have.
 * A sub-day domain is sampled every quarter hour instead, end to end.
 */
export const FINE_STEP_DAYS = 15 / 1440;

/** Log-scale uncertainty of the implied past at the first measurement, and per log-day before it. */
const IMPLIED_SIGMA0 = 0.06;
const IMPLIED_SIGMA_PER_LOGDAY = 0.55;
/**
 * A stretch between two consecutive measurements this far apart or less is still `measured`:
 * the tracker was running, and a straight line between two counts a day apart says nothing the
 * samples do not. Past it we are reconstructing, so the stretch becomes `implied`.
 */
export const MEASURED_GAP_DAYS = 2;
/** Interpolating a gap between two real points is a much smaller claim than the launch is. */
const GAP_SIGMA = 0.12;
/**
 * The join rule. The reconstructed past is the channel shape at the scale fitted through ALL
 * the video's non-stale measurements (fitTrajectory), which in general does NOT pass through
 * the first of them — that is the point: one reading should not set the whole launch. But a
 * line that ends a hand's breadth from the line it is supposed to run into reads as a bug, so
 * over the LAST 10% of the implied span in log(day+1) the fitted value is blended, in log
 * space, toward the value anchored exactly on that first measurement: weight 0 at 90% of the
 * span, weight 1 at the measurement itself. The seam is closed by moving the reconstruction,
 * never by moving a measurement. The same rule closes both ends of a between-measurement gap.
 */
export const JOIN_BLEND = 0.1;

const lg = (d: number) => Math.log(Math.max(d, 0) + 1);

/**
 * The unit-free growth shape a video on this channel follows. With a baseline it is the fitted
 * channel curve; without one the global `mult` alone still gives the shape (the baseline only
 * scales it); with neither it is a straight line in log(day+1), which is the plan's "linear in
 * log between 0 views at day 0 and the first measurement".
 */
function shapeFn(baseline: number | null | undefined, mult: Mult, lt: Longtail | null | undefined) {
  const hasBaseline = baseline != null && baseline > 0 && Number.isFinite(baseline);
  if (hasBaseline) return (d: number) => expectedAt(baseline as number, mult, d, lt).expected;
  return (d: number) => lg(d);
}

function dedupeActuals(actuals: { day: number; views: number }[]) {
  const byDay = new Map<number, number>();
  for (const a of actuals) {
    if (!Number.isFinite(a.day) || a.day < 0 || !(a.views >= 0) || !Number.isFinite(a.views)) continue;
    byDay.set(a.day, a.views);
  }
  return [...byDay.entries()].map(([day, views]) => ({ day, views })).sort((a, b) => a.day - b.day);
}

/** The days the series is sampled at: every integer day, the real measurements, and a launch grid. */
export function seriesDays(horizonDay: number, actualDays: number[]): number[] {
  const end = Math.max(horizonDay, 0);
  const set = new Set<number>([0, end]);
  for (let d = 0; d <= Math.min(end, DENSE_DAYS); d++) set.add(d);
  if (end > DENSE_DAYS) {
    // Past a year of daily points the chart is drawing pixels on top of pixels; keep the axis
    // honest with a log-spaced tail instead.
    const lo = lg(DENSE_DAYS), hi = lg(end);
    for (let i = 1; i <= 60; i++) set.add(Math.exp(lo + ((hi - lo) * i) / 60) - 1);
  }
  for (const h of LAUNCH_DAYS) if (h <= end) set.add(h);
  // A sub-day domain is all launch: the hourly grid above is far too coarse to draw it.
  if (end < 1) {
    for (let t = FINE_STEP_DAYS; t <= end + 1e-9; t += FINE_STEP_DAYS) set.add(Number(t.toFixed(9)));
  }
  for (const d of actualDays) if (d >= 0 && d <= end) set.add(d);
  return [...set].sort((a, b) => a - b);
}

export function buildSeries(input: BuildSeriesInput): SeriesPoint[] {
  const { mult, horizonDay } = input;
  const lt = input.longtail ?? null;
  const bands = input.bands == null ? FITTED_BANDS_2026_09_03 : input.bands;
  // A reading YouTube had already cached when we took it is not a measurement (see
  // ./observations): it is excluded from the line, the anchors and the fit alike.
  const marked = markObservations(dedupeActuals(input.actuals || []));
  const acts = marked.filter((m) => !m.stale).map(({ day, views }) => ({ day, views }));
  const fittable = marked.filter((m) => !m.stale && !m.duplicate).map(({ day, views }) => ({ day, views }));
  const shape = shapeFn(input.baseline, mult, lt);
  const days = seriesDays(horizonDay, acts.map((a) => a.day));
  const byDay = new Map(acts.map((a) => [a.day, a.views] as const));

  const first = acts[0] ?? null;
  const last = acts[acts.length - 1] ?? null;
  // What this video's OWN record says about how predictable it is. The fitted band answers
  // "how wrong is a forecast made at day 4?" across the whole corpus; a video we have watched
  // sit on its channel's curve for ten days is a different case, and the corpus covers both.
  const traj: TrajectoryPoint[] = fittable
    .map((a) => ({ day: a.day, views: a.views, expected: shape(a.day) }))
    .filter((p) => p.expected > 0 && Number.isFinite(p.expected));
  const factor = trajectoryFactor(traj);
  // ONE free parameter — the log scale — fitted through every non-stale measurement, weighted
  // by the log-time span each stands for, so twenty samples inside one launch hour do not
  // outvote a daily record. This, not the first reading, is what the implied past is drawn at.
  const fitScale = traj.length ? Math.exp(fitTrajectory(traj).logScale) : 1;
  const fitted = (d: number) => Math.max(0, shape(d) * fitScale);
  // Nothing measured: the whole past is implied off the channel shape, the future forecast.
  const boundary = last ? last.day : Math.max(input.ageDays ?? 0, 0);

  // Anchored value: the shape rescaled so it passes exactly through `anchor`.
  const anchored = (d: number, anchor: { day: number; views: number }) => {
    const s = shape(d), s0 = shape(anchor.day);
    if (!(s0 > 0) || !Number.isFinite(s0)) return anchor.views;
    return Math.max(0, (s / s0) * anchor.views);
  };

  const out: SeriesPoint[] = [];
  for (const day of days) {
    if (byDay.has(day)) {
      out.push({ day, views: byDay.get(day)!, kind: 'measured' });
      continue;
    }

    if (last && day > last.day) {
      // ---- forecast: continue from the last measurement, landing on est30 at day 30 ----
      const est = input.est30 != null && input.est30 > 0 && Number.isFinite(input.est30) ? input.est30 : null;
      const views = est
        ? forecastAt(last.views, last.day, est, mult, day, lt)
        : anchored(day, last);
      // The band is the corpus's own forecast error at the age of the LAST measurement, not a
      // constant: it opens from nothing at that point (the video is there, we counted it) to
      // the fitted 10-90 range at day 30. lib/scoring/bands.ts.
      const band = forecastBand(views, day, last.day, bands, factor) ?? undefined;
      out.push({ day, views, kind: 'forecast', ...(band ? { band } : {}) });
      continue;
    }

    if (!last) {
      // No measurement anywhere. Past is implied off the shape (nothing to anchor to, so the
      // channel's own typical curve stands in); future is the same curve continued.
      const s = shape(day);
      const kind: SeriesKind = day > boundary ? 'forecast' : 'implied';
      const sigma = IMPLIED_SIGMA0 + IMPLIED_SIGMA_PER_LOGDAY * Math.abs(lg(boundary) - lg(day));
      out.push({ day, views: Math.max(0, s), kind, band: sym(s, sigma) });
      continue;
    }

    if (day < first!.day) {
      // ---- implied past: the launch we never saw ----
      // The fitted shape, blended into the first measurement over the last JOIN_BLEND of the
      // span so the dotted line meets the solid one instead of stopping beside it.
      const L = lg(first!.day);
      const t = L > 0 ? Math.min(Math.max((lg(day) - (1 - JOIN_BLEND) * L) / (JOIN_BLEND * L), 0), 1) : 1;
      const f = fitted(day), a = anchored(day, first!);
      const views = t <= 0 ? f : t >= 1 ? a
        : f > 0 && a > 0 ? Math.exp((1 - t) * Math.log(f) + t * Math.log(a)) : (1 - t) * f + t * a;
      // We know less about the launch the further it is from the first thing we measured.
      const sigma = IMPLIED_SIGMA0 + IMPLIED_SIGMA_PER_LOGDAY * (lg(first!.day) - lg(day));
      out.push({ day, views, kind: 'implied', band: sym(views, sigma) });
      continue;
    }

    // ---- between two real measurements ----
    let lo = acts[0], hi = acts[acts.length - 1];
    for (let i = 1; i < acts.length; i++) {
      if (acts[i].day >= day) { lo = acts[i - 1]; hi = acts[i]; break; }
    }
    if (hi.day - lo.day <= MEASURED_GAP_DAYS) {
      // Close enough that the tracker was watching the whole way: a straight line between two
      // counts a day apart claims nothing the samples do not. No band — nothing is inferred.
      const t = (day - lo.day) / (hi.day - lo.day);
      out.push({ day, views: lo.views + (hi.views - lo.views) * t, kind: 'measured' });
      continue;
    }
    const span = lg(hi.day) - lg(lo.day);
    const w = span > 0 ? (lg(day) - lg(lo.day)) / span : 0;
    const a = anchored(day, lo), b = anchored(day, hi);
    // The middle of the gap follows the SAME fitted scale as the implied past; only the last
    // JOIN_BLEND at each end is blended toward that end's own measurement, so the path leaves
    // `lo` exactly and arrives at `hi` exactly (see JOIN_BLEND).
    const wa = Math.min(Math.max(1 - w / JOIN_BLEND, 0), 1);
    const wb = Math.min(Math.max(1 - (1 - w) / JOIN_BLEND, 0), 1);
    const f = fitted(day);
    const parts: Array<[number, number]> = [[f, Math.max(1 - wa - wb, 0)], [a, wa], [b, wb]];
    const views = parts.every(([v]) => v > 0)
      ? Math.exp(parts.reduce((acc, [v, k]) => acc + k * Math.log(v), 0))
      : parts.reduce((acc, [v, k]) => acc + k * v, 0);
    const sigma = GAP_SIGMA * 2 * Math.min(w, 1 - w); // zero at both ends, widest mid-gap
    out.push({ day, views, kind: 'implied', band: sym(views, sigma) });
  }
  return out;
}

/**
 * The channel's typical curve, sampled on exactly the series' days.
 *
 * The chart zips the two into one row per day. When the typical curve carried its own
 * log-spaced grid, its extra days produced rows with a curve value and no series value — and
 * recharts, told (correctly) not to connect nulls, broke the solid measured line into a piece
 * per interleaved day. One grid, one row, one value each.
 */
export function channelCurve(
  series: SeriesPoint[],
  baseline: number | null | undefined,
  mult: Mult,
  lt?: Longtail | null
): CurvePoint[] {
  if (baseline == null || !(baseline > 0) || !Number.isFinite(baseline)) return [];
  return series.map((p) => expectedAt(baseline, mult, p.day, lt));
}
