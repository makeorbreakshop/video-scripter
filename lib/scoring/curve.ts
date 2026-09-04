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
import { growthLog, type GrowthContext } from './growth';

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

  // 1. a real sample at this age
  const real = samples.filter((s) => Math.abs(s.day - targetAge) <= tol)
    .sort((a, b) => Math.abs(a.day - targetAge) - Math.abs(b.day - targetAge))[0];
  if (real) return { id: prior.id, views: real.views, kind: 'real', fromAge: real.day, logDistance: 0 };

  // 2. the nearest sample, slid along G. Nearest in LOG age: at t = 3d a reading at 1d is nearer
  //    than one at 7d even though both are 2 days away, because growth is log-linear in age.
  const dist = (s: Snapshot) => Math.abs(Math.log(Math.max(s.day, 1 / 1440)) - Math.log(Math.max(targetAge, 1 / 1440)));
  const near = samples.length ? samples.reduce((a, b) => (dist(b) < dist(a) ? b : a)) : null;
  if (near) {
    const ctx: GrowthContext | null = samples.length >= 2
      ? { anchorAge: near.day, q: growthExponent([...samples]) }
      : null;
    const views = near.views * Math.exp(growthLog(params, near.day, targetAge, ctx));
    if (views > 0 && Number.isFinite(views)) {
      return { id: prior.id, views, kind: 'interpolated', fromAge: near.day, logDistance: dist(near) };
    }
  }

  // 3. a lifetime count, slid back down G
  const lt = prior.lifetime;
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
  nTypical: number;
  typicalNeff: number;
  typicalMeasuredShare: number;
  /** v̂(T) along G from the latest reading. */
  projection: number;
  projectionHorizon: number;
  q: number | null;
  confidence: 'insufficient' | 'early' | 'likely' | 'confirmed';
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
  const horizon = inp.projectionHorizon ?? 30;
  const c = channelCurve(inp.priors, inp.age, inp.params);
  const q = growthExponent([...inp.snaps]);
  const ctx: GrowthContext = {
    anchorAge: inp.age, chMultLogs: inp.priorMultLogs ?? [], q,
    bucket: bucketFor(inp.age, fittedBuckets(inp.params)),
  };
  const projection = project(inp.params, inp.vt, inp.age, horizon, ctx);
  const score = c.typical && c.typical > 0 ? inp.vt / c.typical : null;
  const confidence =
    c.typical == null ? 'insufficient' : inp.age < 3 ? 'early' : inp.age < 7 ? 'likely' : 'confirmed';
  return {
    score, ageDays: inp.age, typicalAtAge: c.typical, nTypical: c.n, typicalNeff: c.neff,
    typicalMeasuredShare: c.measuredShare, projection, projectionHorizon: horizon, q, confidence,
  };
}
