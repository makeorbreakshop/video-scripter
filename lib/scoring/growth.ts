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
  bucketFor, fittedBuckets, longtailAt, median, qResidual,
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
  /**
   * Bucket the channel multiplier and the Q bins were read at. Defaults to the fitted bucket
   * nearest the anchor age -- NOT the raw age, which indexes nothing and silently zeroes both
   * the global multiplier and the Q residual.
   */
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
export function blendScale(params: GlobalParams, ctx: GrowthContext | null | undefined): number {
  if (!ctx) return 1;
  const anchor = ctx.anchorAge;
  if (!(anchor > 0) || anchor >= 30) return 1;      // past day 30 v3 makes no channel claim
  const base = logToRef(params, anchor);
  if (!(base > 1e-6)) return 1;                      // nothing to scale
  const adj = anchorAdjust(params, ctx, ctx.bucket ?? bucketFor(anchor, fittedBuckets(params)));
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
  ctx?: GrowthContext | null
): number {
  const s = blendScale(params, ctx);
  return s * (logToRef(params, fromAge) - logToRef(params, toAge));
}

/** Slide a measurement from one age to another along the curve. */
export function slide(
  params: GlobalParams,
  views: number,
  fromAge: number,
  toAge: number,
  ctx?: GrowthContext | null
): number {
  return views * Math.exp(growthLog(params, fromAge, toAge, ctx));
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

// ---- fitting the sub-day half of G ------------------------------------------------------
//
// v3's `core.fitLaunchLadder` fitted the hour buckets from whatever (sample, day-1) pairs the
// last 30 days happened to hold, with minRows = 50 and no outlier handling, and it SKIPPED an
// unfitted bucket -- so `logToRef` then interpolated straight across the hole, between two
// buckets that could be six hours apart. That is most of why the leave-one-out G check reads
// medALE 1.60 below one hour and 1.06 from 1-4h while every bucket past 12h is under 0.13.
//
// v5 refits the same ladder from the launch-tracker era only (view_samples since 2026-08-01,
// when the 5/15/30-minute ladder was actually running), with:
//   - a robust median of log(v1 / v_h), as before;
//   - two-sided winsorising at the 5th/95th percentile per bucket, so a video whose day-1
//     reading landed after a spike cannot drag the bucket. (A median barely moves under this;
//     it is a guard, not an estimator change, and the fit logs both so the difference is visible.)
//   - minRows = 200 per bucket, and a bucket that misses it CARRIES THE PREVIOUS (younger)
//     bucket's value forward instead of being skipped -- no silent interpolation across a hole;
//   - monotone non-increasing in age, enforced after the fact.

export const LAUNCH_MIN_ROWS = 200;
/** Launch-tracker era: view_samples before this date are not a 5-minute ladder. */
export const LAUNCH_FIT_SINCE = '2026-08-01';

export interface LadderFit {
  mult: Record<number, number>;
  n: Record<number, number>;
  /** Buckets that met minRows and were fitted from their own rows. */
  fitted: number[];
  /** Buckets that missed minRows and carried the previous bucket's value forward. */
  carried: number[];
}

/** Two-sided winsorise at [p, 1-p] of the sorted sample. Returns a new array. */
export function winsorise(xs: readonly number[], p = 0.05): number[] {
  if (xs.length < 3) return [...xs];
  const s = [...xs].sort((a, b) => a - b);
  const lo = s[Math.floor(p * (s.length - 1))];
  const hi = s[Math.floor((1 - p) * (s.length - 1))];
  return xs.map((x) => Math.min(Math.max(x, lo), hi));
}

export function fitLaunchLadderV5(
  rows: readonly LaunchRow5[],
  day1Mult: number,
  minRows = LAUNCH_MIN_ROWS
): LadderFit {
  const mult: Record<number, number> = {}; const n: Record<number, number> = {};
  const fitted: number[] = []; const carried: number[] = [];
  // Ascending in age, so "the previous bucket" is the next-younger one -- the direction the
  // curve is monotone in, and the only fallback that cannot invent growth that was never seen.
  const asc = [...HOUR_BUCKETS].sort((a, b) => a - b);
  let last: number | null = null;
  for (const b of asc) {
    const hb = b * 24; const tol = Math.max(hb * 0.15, 0.25);
    const rs = rows.filter((r) => r.vh > 0 && r.v1 > 0 && Math.abs(r.hours - hb) <= tol);
    n[b] = rs.length;
    if (rs.length >= minRows) {
      const logs = winsorise(rs.map((r) => Math.log(r.v1 / r.vh)));
      const m = median(logs)! + day1Mult;
      mult[b] = Math.max(m, day1Mult);   // never less growth left than at day 1
      last = mult[b];
      fitted.push(b);
    } else if (last != null) {
      mult[b] = last;                     // carry forward, do not leave a hole to interpolate over
      carried.push(b);
    }
    // no `last` yet and not enough rows: leave the bucket out entirely, as v3 did. logToRef then
    // clamps at the earliest bucket it does have, which is the honest answer for "never measured".
  }
  // monotone non-increasing in age: walk from the oldest hour back to the youngest.
  const present = asc.filter((b) => mult[b] != null);
  for (let i = present.length - 2; i >= 0; i--) {
    mult[present[i]] = Math.max(mult[present[i]], mult[present[i + 1]]);
  }
  return { mult, n, fitted, carried };
}

/** (sample at `hours`, day-1 reading) pair. Same shape as core.LaunchRow, restated with G. */
export interface LaunchRow5 { hours: number; vh: number; v1: number }

// ---- the early floor --------------------------------------------------------------------
//
// Below four hours the leave-one-out check says G's own reconstruction error is larger than the
// signal: medALE 1.60 under an hour and 1.06 from 1-4h, against 0.13 by 12h. A ratio built on a
// denominator with 100%+ error is not a score, it is a number. So under the floor the score is
// null and the confidence is 'early' -- the raw views are still stored, and the next reading
// past the floor produces a real score.
export const AGE_FLOOR_HOURS = 4;
export const AGE_FLOOR_DAYS = AGE_FLOOR_HOURS / 24;

/** True when the video is too young for G to carry a denominator honestly. */
export function belowAgeFloor(ageDays: number): boolean {
  return !(ageDays >= AGE_FLOOR_DAYS);
}

// ---- projection horizons ----------------------------------------------------------------
//
// Verification part 4: from a day-1 reading, medALE to T=30 is 0.231 and to T=365 is 0.672 with
// bias +0.232. The 90/365 horizons exist in the code and are honestly measured, but they are not
// a product yet, so the shipped horizon is capped at 30 -- where the v4 bands were fitted and
// where the benchmark can still compare v5 to v4.
export const PROJECTION_MAX_DAYS = 30;
/** Off. Flip only with band calibration for the longer horizons in hand. */
export const LONG_HORIZONS_ENABLED = false;
export const LONG_HORIZONS = [90, 365] as const;

/** Clamp a requested horizon to what is shipped. */
export function allowedHorizon(requested: number): number {
  if (!Number.isFinite(requested) || requested <= 0) return PROJECTION_MAX_DAYS;
  if (LONG_HORIZONS_ENABLED) return requested;
  return Math.min(requested, PROJECTION_MAX_DAYS);
}
