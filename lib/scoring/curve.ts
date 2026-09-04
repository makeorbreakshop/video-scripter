// v5 channel curve and same-age score. Pure functions, no I/O.
//
//   score(t) = v(t) / C(t)
//
// C(t) is what a normal video on this channel has at age t: the v4 time-weighted log-median over
// the channel's recent prior videos, where each prior contributes its views AT AGE t. A prior
// contributes three ways, best first -- the day-30 'real / projected / lifetime' logic of
// core.priorV30 generalised off day 30 and onto every age, with G doing the sliding:
//
//   real          a sample within tolerance of t              (no translation error)
//   interpolated  its nearest sample slid along G to t        (error grows with log-distance)
//   lifetime      its lifetime count slid back along G to t   (largest; pre-tracking videos)
//
// Every contribution carries its kind and its log-distance, so a score can say how much of its
// denominator was measured rather than modelled -- `measuredShare`. This is what fills
// `same_age_ratio`, which in v4 was simply null whenever no prior had a real sample near t
// (Allrecipes "18 Microwave Hacks" at 3d: null, n_same_age 0).
import {
  BASELINE_HALF_LIFE_DAYS, MIN_BASELINE_NEFF, MIN_BASELINE_PRIORS,
  baselineWeight, bucketFor, effectiveN, fittedBuckets, growthExponent, weightedMedian,
  type GlobalParams, type Snapshot,
} from './core';
import { growthLog, allowedHorizon, belowAgeFloor, type GrowthContext } from './growth';

/**
 * Below one day a prior may only be slid from a sample YOUNGER than this. Sliding a day-17
 * reading back to five hours is a 2-nat extrapolation on a curve fitted forward, and it was the
 * larger half of the 2026-09-04 sub-day bug (see the header note on the blend scale).
 */
export const SUBDAY_SLIDE_MAX_AGE = 3;

/** How close a prior's reading has to be to age `t` to count as MEASURED at t. */
export function sameAgeTolerance(age: number): number {
  if (!(age > 0)) return 1 / 48;
  if (age < 1) return Math.max(age * 0.25, 1 / 48);
  if (age <= 3) return 1;
  if (age <= 7) return 2;
  if (age <= 30) return 3;
  return Math.max(3, age * 0.1);   // past 30d the snapshot cadence is 3-daily, then weekly
}

export type ContribKind = 'real' | 'interpolated' | 'lifetime';

export interface CurvePrior {
  /** Days between the TARGET's publish time and this prior's -- what the age kernel weights by. */
  ageDays: number;
  /** This prior's readings at TRUE age, already censored to the target's clock. */
  samples: readonly Snapshot[];
  /** Lifetime count and the age it was read at, for pre-tracking priors with no usable samples. */
  lifetime?: { views: number; ageDays: number } | null;
  id?: string;
}

export interface Contribution {
  id?: string;
  views: number;
  kind: ContribKind;
  /** Age the contribution was actually measured at (== targetAge for 'real'). */
  fromAge: number;
  /** |log(targetAge / fromAge)| -- how far G had to carry it. 0 for 'real'. */
  logDistance: number;
  weight: number;
}

export interface CurveResult {
  /** C(t): time-weighted geometric median of the contributions. Null when the floors fail. */
  typical: number | null;
  /** Priors that produced a usable contribution. */
  n: number;
  /** Effective prior count after age weighting: (sum w)^2 / sum w^2. */
  neff: number;
  /** Fraction of contributions that were real samples at age t. */
  measuredShare: number;
  contributions: Contribution[];
}

/** One prior's views at age t, by the best available route. Null when it has nothing usable. */
export function contributionAt(
  prior: CurvePrior,
  targetAge: number,
  params: GlobalParams
): Omit<Contribution, 'weight'> | null {
  const samples = [...prior.samples].filter((s) => s.views > 0 && Number.isFinite(s.day) && s.day >= 0)
    .sort((a, b) => a.day - b.day);
  const tol = sameAgeTolerance(targetAge);
  // Under one day the denominator has to be MEASURED, or slid from something close to it. A
  // lifetime count at day 300 and a snapshot at day 17 both say nothing about hour five.
  const subDay = targetAge < 1;

  // 1. a real sample at this age
  const real = samples.filter((s) => Math.abs(s.day - targetAge) <= tol)
    .sort((a, b) => Math.abs(a.day - targetAge) - Math.abs(b.day - targetAge))[0];
  if (real) return { id: prior.id, views: real.views, kind: 'real', fromAge: real.day, logDistance: 0 };

  // 2. the nearest sample, slid along G. Nearest in LOG age: at t = 3d a reading at 1d is nearer
  //    than one at 7d even though both are 2 days away, because growth is log-linear in age.
  const dist = (s: Snapshot) => Math.abs(Math.log(Math.max(s.day, 1 / 1440)) - Math.log(Math.max(targetAge, 1 / 1440)));
  const near = samples.length ? samples.reduce((a, b) => (dist(b) < dist(a) ? b : a)) : null;
  if (near && !(subDay && near.day > SUBDAY_SLIDE_MAX_AGE)) {
    // The per-prior blend is only applied FORWARD, from the anchor toward day 30 -- the interval
    // `blendScale` was calibrated on. It is a positive scale, s = 1 + adj / logToRef(anchor),
    // dividing the anchor's Q residual by the growth LEFT at the anchor, which is near zero for a
    // prior read at day 17-26. Sliding BACKWARD past the anchor turns that into an extrapolation
    // with a long lever arm: at day 17 a -0.070 residual over a base of 0.069 gave s = 0.100 (the
    // clamp floor), which flattened the whole slide back to five hours and left the prior with
    // 82% of its day-17 views there. Below the anchor, the global curve only.
    const ctx: GrowthContext | null = targetAge >= near.day && samples.length >= 2
      ? { anchorAge: near.day, q: growthExponent([...samples]) }
      : null;
    const views = near.views * Math.exp(growthLog(params, near.day, targetAge, ctx));
    if (views > 0 && Number.isFinite(views)) {
      return { id: prior.id, views, kind: 'interpolated', fromAge: near.day, logDistance: dist(near) };
    }
  }

  // 3. a lifetime count, slid back down G
  const lt = subDay ? null : prior.lifetime;
  if (lt && lt.views > 0 && Number.isFinite(lt.ageDays) && lt.ageDays > 0) {
    const views = lt.views * Math.exp(growthLog(params, lt.ageDays, targetAge));
    if (views > 0 && Number.isFinite(views)) {
      return {
        id: prior.id, views, kind: 'lifetime', fromAge: lt.ageDays,
        logDistance: Math.abs(Math.log(lt.ageDays) - Math.log(Math.max(targetAge, 1 / 1440))),
      };
    }
  }
  return null;
}

/**
 * C(t) -- what a normal video on this channel has at age t. Time-weighted median in LOG space
 * (v4's rule, unchanged) over the priors' contributions at that age. Null unless there are
 * >= MIN_BASELINE_PRIORS contributions AND effective n >= MIN_BASELINE_NEFF.
 */
export function channelCurve(
  priors: readonly CurvePrior[],
  targetAge: number,
  params: GlobalParams,
  halfLife = BASELINE_HALF_LIFE_DAYS
): CurveResult {
  const contributions: Contribution[] = [];
  for (const p of priors) {
    const c = contributionAt(p, targetAge, params);
    if (c) contributions.push({ ...c, weight: baselineWeight(p.ageDays, halfLife) });
  }
  const ws = contributions.map((c) => c.weight);
  const neff = effectiveN(ws);
  const nReal = contributions.filter((c) => c.kind === 'real').length;
  const measuredShare = contributions.length ? nReal / contributions.length : 0;
  if (contributions.length < MIN_BASELINE_PRIORS || neff < MIN_BASELINE_NEFF) {
    return { typical: null, n: contributions.length, neff, measuredShare, contributions };
  }
  const m = weightedMedian(contributions.map((c) => Math.log(c.views)), ws);
  return { typical: m == null ? null : Math.exp(m), n: contributions.length, neff, measuredShare, contributions };
}

// ---- the score ------------------------------------------------------------------------

export interface V5Input {
  /** This video's latest reading. */
  vt: number;
  /** TRUE age at that reading, in days. */
  age: number;
  /** This video's own record so far, for Q. */
  snaps: readonly Snapshot[];
  priors: readonly CurvePrior[];
  /** Channel priors' log(v30 / v_t) near this video's bucket -- the v3 est30 blend, for G. */
  priorMultLogs?: readonly number[];
  /** Horizon for the display projection. 30 keeps the v4 number comparable. */
  projectionHorizon?: number;
  params: GlobalParams;
}

export interface V5Output {
  score: number | null;
  ageDays: number;
  typicalAtAge: number | null;
  /**
   * C(30): the channel's typical views at day 30 -- the DISPLAY anchor. This is what the channel
   * Analytics chart and the list sparklines plot over time, so it must not move with the video's
   * age. It is the v4 `baseline`; `typicalAtAge` is the score's denominator.
   */
  typicalAt30: number | null;
  nTypical: number;
  typicalNeff: number;
  typicalMeasuredShare: number;
  /** v̂(T) along G from the latest reading. */
  projection: number;
  projectionHorizon: number;
  q: number | null;
  confidence: 'insufficient' | 'early' | 'likely' | 'confirmed';
  /** True when age < growth.AGE_FLOOR_HOURS: raw views only, no score. */
  belowAgeFloor: boolean;
}

/** v̂(T) = v(t) · exp(growthLog(t → T)), the projection product -- separate from the score. */
export function project(
  params: GlobalParams,
  vt: number,
  fromAge: number,
  toAge: number,
  ctx?: GrowthContext | null
): number {
  return vt * Math.exp(growthLog(params, fromAge, toAge, ctx));
}

export function scoreV5(inp: V5Input): V5Output {
  const horizon = allowedHorizon(inp.projectionHorizon ?? 30);
  const c = channelCurve(inp.priors, inp.age, inp.params);
  const c30 = inp.age === 30 ? c : channelCurve(inp.priors, 30, inp.params);
  const q = growthExponent([...inp.snaps]);
  const ctx: GrowthContext = {
    anchorAge: inp.age, chMultLogs: inp.priorMultLogs ?? [], q,
    bucket: bucketFor(inp.age, fittedBuckets(inp.params)),
  };
  const projection = project(inp.params, inp.vt, inp.age, horizon, ctx);
  // Under AGE_FLOOR_HOURS, G's own reconstruction error exceeds the signal (leave-one-out
  // medALE 1.60 under an hour), so there is no honest denominator yet. Views are still carried;
  // only the ratio is withheld. See growth.AGE_FLOOR_HOURS.
  const tooYoung = belowAgeFloor(inp.age);
  const score = !tooYoung && c.typical && c.typical > 0 ? inp.vt / c.typical : null;
  const confidence: V5Output['confidence'] =
    tooYoung ? 'early'
    // Under a day, "no usable prior at this age" is a fact about the CLOCK, not about the
    // channel's history: the same priors will produce a denominator tomorrow. So it reads
    // 'early', not 'insufficient'. Views are still stored; only the ratio is withheld.
    : c.typical == null ? (inp.age < 1 ? 'early' : 'insufficient')
    : inp.age < 3 ? 'early' : inp.age < 7 ? 'likely' : 'confirmed';
  return {
    score, ageDays: inp.age, typicalAtAge: tooYoung ? null : c.typical,
    typicalAt30: c30.typical,
    nTypical: c.n, typicalNeff: c.neff,
    typicalMeasuredShare: c.measuredShare, projection, projectionHorizon: horizon, q, confidence,
    belowAgeFloor: tooYoung,
  };
}

