// v5 growth model: ONE growth function from the first launch bucket to the last long-tail age.
//
// v3/v4 carried two disagreeing sub-day paths: `core.logMultTo30` interpolated the DAY_BUCKETS
// only and clamped to the day-1 multiplier (~2.4x) below one day, while `core.scoreVideo` used
// `bucketFor` + the fitted launch ladder (~3.18x at half a day). Same question, two answers,
// ~22% apart -- which is why the band fitter measured the sub-day forecast LOW and the benchmark
// measured it HIGH (docs/benchmarks, 2026-09-03 open finding).
//
// v5 replaces both with a single cumulative curve read at TRUE age:
//
//   logToRef(age)  =  log( E[v(30)] / E[v(age)] )     -- "log growth still to come, to day 30"
//
// defined continuously on (0, inf):
//   age  < 1   log-linear in log(age) across the fitted launch ladder (HOUR_BUCKETS) up to day 1,
//              clamped at the earliest fitted hour bucket
//   1..30      log-linear in log(age) across DAY_BUCKETS (identical to the old logMultTo30)
//   age >= 30  NEGATIVE: -log(longtail multiplier from 30 to age); day 30 is not the end of life
//
// The seam at day 1 is exact by construction: both branches evaluate to params.mult[1] there.
//
// Growth between any two ages is the difference of the cumulative, so the function is
// antisymmetric (slide forward then back returns the input) and monotone by construction.
//
// Channel blending and the per-video Q correction are applied as a single positive SCALE on the
// cumulative, chosen so that anchor -> 30 reproduces v3/v4's `remaining` exactly. Scaling rather
// than adding keeps antisymmetry and monotonicity for every (from, to) pair.
import {
  DAY_BUCKETS, HOUR_BUCKETS, K_SHRINK, type GlobalParams, type LongtailTable,
  longtailAt, median, qResidual,
} from './core';

/** Hour buckets this params table actually has a fitted multiplier for, ascending. */
export function fittedHourBuckets(params: GlobalParams): number[] {
  return HOUR_BUCKETS.filter((b) => params.mult[b] != null);
}

/**
 * Long-tail multiplier at any age >= 30, ramping linearly from 1.0 at day 30 to the fitted
 * first long-tail bucket (60d), then log-linear across the table. Same rule as
 * core.longtailFrom30, restated here so the whole curve lives in one file.
 */
function tailMult(lt: LongtailTable | undefined | null, age: number): number {
  const first = lt?.ages?.[0] ?? 60;
  if (age >= first) return Math.max(longtailAt(lt, age), 1);
  if (age <= 30) return 1;
  const m = Math.max(longtailAt(lt, first), 1);
  return 1 + (m - 1) * ((age - 30) / (first - 30));
}

/** Log-linear interpolation of `f` over an ascending bucket list, in log(age). Clamped. */
function interpLogAge(buckets: readonly number[], f: (b: number) => number, age: number): number {
  if (age <= buckets[0]) return f(buckets[0]);
  const last = buckets.length - 1;
  if (age >= buckets[last]) return f(buckets[last]);
  for (let i = 1; i <= last; i++) {
    if (age <= buckets[i]) {
      const x0 = Math.log(buckets[i - 1]), x1 = Math.log(buckets[i]), x = Math.log(age);
      return f(buckets[i - 1]) + ((f(buckets[i]) - f(buckets[i - 1])) * (x - x0)) / (x1 - x0);
    }
  }
  return f(buckets[last]);
}

/**
 * The cumulative curve: log( expected views at day 30 / expected views at `age` ).
 * Positive before day 30, zero at day 30, negative after it. Strictly non-increasing in age.
 */
export function logToRef(params: GlobalParams, age: number): number {
  const m = (k: number) => params.mult[k] ?? 0;
  const a = Number.isFinite(age) && age > 0 ? age : 1 / 1440; // a minute floor; log(0) is not a number
  if (a >= 30) return -Math.log(tailMult(params.longtail, a));
  if (a >= 1) return interpLogAge([...DAY_BUCKETS], m, a);
  const hours = fittedHourBuckets(params);
  if (!hours.length) return m(1); // unfitted ladder: the v3 clamp, explicitly and only here
  return interpLogAge([...hours, 1], m, a);
}

export interface GrowthContext {
  /**
   * Age at which the channel multiplier / Q were observed -- the video's latest reading. The
   * blend is anchored here so that anchor -> 30 reproduces v3 exactly and every other pair is
   * the same curve read at two points.
   */
  anchorAge: number;
  /** Channel priors' log(v30 / v_t) near the anchor bucket. Empty => pure global curve. */
  chMultLogs?: readonly number[];
  /** The video's own growth exponent, or null when it has fewer than 2 samples. */
  q?: number | null;
  /** Bucket the channel multiplier and the Q bins were read at (defaults to the anchor bucket). */
  bucket?: number;
}

/** The v3 total correction at the anchor: w*chm + (1-w)*g - g + qResidual, i.e. the delta on `g`. */
function anchorAdjust(params: GlobalParams, ctx: GrowthContext, bucket: number): number {
  const g = params.mult[bucket] ?? 0;
  const logs = ctx.chMultLogs ?? [];
  const n = logs.length;
  const chm = n ? median([...logs])! : g;
  const w = n / (n + K_SHRINK(bucket));
  return w * (chm - g) + qResidual(params, bucket, ctx.q ?? null);
}

/** Positive scale on the cumulative curve that carries the channel blend and the Q correction. */
export function blendScale(params: GlobalParams, ctx: GrowthContext | null | undefined, bucketOf: (age: number) => number): number {
  if (!ctx) return 1;
  const anchor = ctx.anchorAge;
  if (!(anchor > 0) || anchor >= 30) return 1;      // past day 30 v3 makes no channel claim
  const base = logToRef(params, anchor);
  if (!(base > 1e-6)) return 1;                      // nothing to scale
  const adj = anchorAdjust(params, ctx, ctx.bucket ?? bucketOf(anchor));
  const s = 1 + adj / base;
  return Math.min(Math.max(s, 0.1), 10);             // never invert or explode the curve
}

/**
 * THE growth function. Log growth from `fromAge` to `toAge` on this params table, optionally
 * channel-blended and Q-corrected through `ctx`.
 *
 *   v_hat(toAge) = v(fromAge) * exp( growthLog(params, fromAge, toAge, ctx) )
 *
 * Properties (asserted in growth.test.ts): 0 when fromAge == toAge; monotone non-decreasing in
 * `toAge`; continuous across the day-1 seam; antisymmetric, so sliding forward and back returns
 * the input exactly.
 */
export function growthLog(
  params: GlobalParams,
  fromAge: number,
  toAge: number,
  ctx?: GrowthContext | null,
  bucketOf: (age: number) => number = (a) => a
): number {
  const s = blendScale(params, ctx, bucketOf);
  return s * (logToRef(params, fromAge) - logToRef(params, toAge));
}

/** Slide a measurement from one age to another along the curve. */
export function slide(
  params: GlobalParams,
  views: number,
  fromAge: number,
  toAge: number,
  ctx?: GrowthContext | null,
  bucketOf?: (age: number) => number
): number {
  return views * Math.exp(growthLog(params, fromAge, toAge, ctx, bucketOf));
}

// ---- fitting the past-30 buckets -------------------------------------------------------
//
// The long-tail table was fitted as `lifetime_views / v30` from whatever later count existed.
// v5 needs it as a genuine part of G, so it is refit from SNAPSHOT PAIRS in a trailing window:
// every (day-30 reading, later reading) pair on the same video, bucketed by the later reading's
// age. Pairs rather than lifetime counts because a lifetime count is read today while the day-30
// reading is old, which quietly mixes calendar time into an age curve.
export const PAST30_AGES = [60, 90, 180, 365, 730] as const;

export interface TailPair { laterAge: number; v30: number; later: number }

/**
 * Median later/v30 per age bucket, monotone non-decreasing and never below 1. Buckets with
 * fewer than `minRows` pairs carry the previous value forward (and record n = the real count,
 * so a report can say which buckets are actually supported).
 */
export function fitPast30(
  pairs: TailPair[],
  ages: readonly number[] = PAST30_AGES,
  minRows = 20
): LongtailTable {
  const mult: number[] = []; const n: number[] = [];
  let last = 1;
  for (let i = 0; i < ages.length; i++) {
    const lo = ages[i];
    const hi = i + 1 < ages.length ? ages[i + 1] : Infinity;
    const rs = pairs.filter((p) => p.v30 > 0 && p.later > 0 && p.laterAge >= lo && p.laterAge < hi);
    n.push(rs.length);
    const m = rs.length >= minRows ? median(rs.map((p) => p.later / p.v30)) : null;
    last = Math.max(m ?? last, last, 1);
    mult.push(last);
  }
  return { ages: [...ages], mult, n };
}
