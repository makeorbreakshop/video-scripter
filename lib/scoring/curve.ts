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
  ALL_BUCKETS, BASELINE_HALF_LIFE_DAYS, LONGTAIL_AGES, MIN_BASELINE_NEFF, MIN_BASELINE_PRIORS,
  baselineWeight, bucketFor, effectiveN, fittedBuckets, growthExponent, median, weightedMedian,
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

/**
 * How C(t) was arrived at.
 *   measured    >= MIN_BASELINE_PRIORS contributions exist AT t and neff clears the floor.
 *   estimated   they do not, so C was read at the nearest anchor age where they do and slid to
 *               t along G. Everything the reader is told about n / neff belongs to the ANCHOR.
 */
export type TypicalKind = 'measured' | 'estimated';

export interface CurveResult {
  /** C(t): time-weighted geometric median of the contributions. Null when the floors fail. */
  typical: number | null;
  /** Whether `typical` was measured at t or slid to t from `anchorAge`. */
  kind: TypicalKind;
  /** For 'estimated': the age C was actually measured at. Null for 'measured' and for null C. */
  anchorAge: number | null;
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
 * How many median publish gaps wide the age kernel is on a slow channel.
 *
 * k = 1.5, from the k sweep on the Jul-Aug 2025 holdout (2,222 videos, the whole eligible
 * population -- there is no second cut: no other month has both an early and a day-30 snapshot).
 * Every k is a no-op on the daily and weekly slices, so the sparse slice at 1.5 / 2 decides it:
 *
 *   t=3 sparse (n=141)  tw30 F1 .653   k=1.5 .625 (-.028)   k=2 .625 (-.028)
 *   t=7 sparse (n=151)  tw30 F1 .767   k=1.5 .746 (-.021)   k=2 .733 (-.034)
 *
 * k = 2 is outside the skill's 0.03 F1 gate at t=7 and k = 1.5 is inside it, and the deficit is
 * not a coverage artefact: restricted to the rows BOTH rules cover the numbers are unchanged to
 * three decimals, because the rows the wider kernel newly covers are all true negatives. It is
 * also barely anything -- at t=7 the whole difference between k=1.5 and k=2 is one video moving
 * from true positive to false positive, well inside the noise of 33 positives. The gate is the
 * gate, and k = 1.5 costs almost nothing to honour: on 250 videos from tracked channels
 * publishing slower than weekly it recovers 56% of the rows the fixed 30-day kernel starves
 * against k = 2's 61%, i.e. 91% of the coverage k = 2 buys. (k = 3 recovers 72% and fails the
 * gate outright, .65 -> .57 at t=3.)
 */
export const CADENCE_HALF_LIFE_K = 1.5;

/**
 * The half-life of the baseline age kernel, in the channel's own rhythm.
 *
 * "Recent" is the channel's last handful of videos, whether that spans a month or two years.
 * A fixed 30-day half-life reads a monthly channel's own previous video at half weight and the
 * one before it at a quarter, so `neff` falls under MIN_BASELINE_NEFF and the channel has no
 * baseline at all despite a full history (12,379 rows corpus-wide, 2026-09-07 audit). Scaling
 * the kernel by the channel's median publish gap keeps the same "last handful of videos"
 * meaning at every cadence, and the 30-day floor keeps fast channels exactly where they were.
 *
 * `priorPublishTimes` are epoch milliseconds. Fewer than three priors has no measurable
 * cadence, so the floor stands.
 */
export function cadenceHalfLifeDays(priorPublishTimes: readonly number[]): number {
  const p = [...priorPublishTimes].filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  if (p.length < 3) return BASELINE_HALF_LIFE_DAYS;
  const gaps: number[] = [];
  for (let i = 1; i < p.length; i++) gaps.push((p[i] - p[i - 1]) / 86_400_000);
  const g = median(gaps);
  if (!(g != null && Number.isFinite(g) && g > 0)) return BASELINE_HALF_LIFE_DAYS;
  return Math.max(BASELINE_HALF_LIFE_DAYS, CADENCE_HALF_LIFE_K * g);
}

/**
 * The same rule off the priors themselves. `ageDays` is days BEFORE the target's publish, so
 * negating it gives a publish time on an arbitrary but consistent clock -- the gaps are what
 * the cadence is made of, and they are identical either way.
 */
export function cadenceHalfLifeForPriors(priors: readonly CurvePrior[]): number {
  return cadenceHalfLifeDays(priors.map((p) => -p.ageDays * 86_400_000));
}

/**
 * The largest share of the kernel's total weight one prior may hold.
 *
 * A weighted median is only a median while no single weight reaches half the total. The moment
 * one prior carries more than half, the "median" is that prior's number and the rest of the
 * channel is ignored -- and MIN_BASELINE_NEFF (2) does not prevent it: neff 2.44 still lets the
 * newest prior hold 60%. That is exactly what happened to Av0K0TRhbhw ("Cabinets are expensive",
 * scored 2026-09-07 at 326d): a 55d cadence kernel put 0.643 of 1.077 total weight on the one
 * video published 35 days before it -- the channel's weakest in two years, 90k -- so C(t) was
 * 90,048 and the score read 17.0x, while the video published a month later divided by 1.01M.
 * At a third, crossing the half-way mark always takes at least two priors, so the median is
 * a level of the channel and never a single upload. Fifteen daily priors on the 30-day kernel
 * have a top share of 0.10, so fast channels never widen.
 */
export const MAX_PRIOR_WEIGHT_SHARE = 1 / 3;

/** Widening step for the kernel search; the result is deterministic in the prior gaps alone. */
const KERNEL_WIDEN_STEP = 1.25;

/** Largest single weight as a fraction of the total. 1 for a single prior, 0 for none. */
export function maxWeightShare(ws: readonly number[]): number {
  const ok = ws.filter((w) => w > 0 && Number.isFinite(w));
  if (!ok.length) return 0;
  return Math.max(...ok) / ok.reduce((a, b) => a + b, 0);
}

/**
 * The half-life the baseline kernel actually uses: the cadence rule (`cadenceHalfLifeForPriors`),
 * widened by KERNEL_WIDEN_STEP until no prior holds more than MAX_PRIOR_WEIGHT_SHARE of the
 * total weight. With three or more priors the search always terminates: as the half-life grows
 * the weights flatten toward equal and the top share toward 1/n <= 1/3. Under three priors there
 * is no baseline anyway (MIN_BASELINE_PRIORS), so the cadence value is returned unchanged.
 */
export function kernelHalfLifeForPriors(priors: readonly CurvePrior[]): number {
  let hl = cadenceHalfLifeForPriors(priors);
  const gaps = priors.map((p) => p.ageDays).filter((g) => Number.isFinite(g));
  if (gaps.length < MIN_BASELINE_PRIORS) return hl;
  const shareAt = (h: number) => maxWeightShare(gaps.map((g) => baselineWeight(g, h)));
  for (let i = 0; i < 200 && shareAt(hl) > MAX_PRIOR_WEIGHT_SHARE; i++) hl *= KERNEL_WIDEN_STEP;
  return hl;
}


/**
 * The ages an ESTIMATED C(t) is allowed to be anchored at, nearest-first in LOG age.
 *
 * A fixed ladder rather than "any age the priors happen to have a reading at": the anchor has to
 * be reproducible from the target age alone, or two runs on the same channel can pick different
 * anchors as snapshots arrive and the line moves for a reason no one can name. The rungs are the
 * fitted growth buckets (ALL_BUCKETS -- the hour ladder and the day buckets), the long-tail ages,
 * and day 30 explicitly, which is the one age every scored channel has a level at (it is the
 * display anchor the channel chart already plots).
 */
export const ESTIMATE_ANCHORS: readonly number[] =
  [...ALL_BUCKETS, 30, ...LONGTAIL_AGES]
    .filter((a, i, xs) => xs.indexOf(a) === i)
    .sort((a, b) => a - b);

/** The ladder for one target age: every rung but the target itself, nearest first in log age. */
export function estimateLadder(targetAge: number): number[] {
  const t = Math.max(targetAge, 1 / 1440);
  return ESTIMATE_ANCHORS
    .filter((a) => Math.abs(Math.log(a) - Math.log(t)) > 1e-9)
    .sort((a, b) => Math.abs(Math.log(a) - Math.log(t)) - Math.abs(Math.log(b) - Math.log(t)));
}

/**
 * How many priors this channel has an actual reading for at BOTH ages -- the support behind a
 * channel-specific anchor -> target multiplier. `sameAgeTolerance` at each end, the same window
 * that decides whether a contribution counts as MEASURED.
 */
export function priorsSpanning(
  priors: readonly CurvePrior[],
  fromAge: number,
  toAge: number
): { n: number; logs: number[] } {
  const near = (p: CurvePrior, age: number) => {
    const tol = sameAgeTolerance(age);
    return [...p.samples].filter((sm) => sm.views > 0 && Math.abs(sm.day - age) <= tol)
      .sort((a, b) => Math.abs(a.day - age) - Math.abs(b.day - age))[0] ?? null;
  };
  const logs: number[] = [];
  for (const p of priors) {
    const a = near(p, fromAge), b = near(p, toAge);
    if (a && b) logs.push(Math.log(b.views / a.views));
  }
  return { n: logs.length, logs };
}

/** Priors needed at BOTH ends before the channel's own slide is preferred to the global shape. */
export const MIN_SPAN_PRIORS = 5;

/**
 * Log growth from `fromAge` to `toAge` used to slide an estimated C.
 *
 * The global shape (growth.growthLog) unless this channel has >= MIN_SPAN_PRIORS priors with a
 * real reading at both ends, in which case their own median log ratio is blended in by
 * n / (n + k) -- the shrinkage the rest of the model uses for a channel multiplier. In practice
 * the blended branch is close to unreachable: MIN_SPAN_PRIORS priors with a reading at the
 * target age would themselves be MEASURED contributions there, so the curve would not be
 * estimated at all. It exists for the neff-starved corner (enough contributions, lopsided
 * weights) and is asserted rather than assumed.
 */
export function estimateSlideLog(
  priors: readonly CurvePrior[],
  fromAge: number,
  toAge: number,
  params: GlobalParams
): { log: number; channelN: number } {
  const g = growthLog(params, fromAge, toAge);
  const { n, logs } = priorsSpanning(priors, fromAge, toAge);
  if (n < MIN_SPAN_PRIORS) return { log: g, channelN: n };
  const ch = median([...logs]);
  if (ch == null || !Number.isFinite(ch)) return { log: g, channelN: n };
  const w = n / (n + 2);
  return { log: w * ch + (1 - w) * g, channelN: n };
}

/**
 * C(t) MEASURED AT t -- what a normal video on this channel has at age t, from the priors' own
 * readings at that age. Time-weighted median in LOG space (v4's rule, unchanged). Null unless
 * there are >= MIN_BASELINE_PRIORS contributions AND effective n >= MIN_BASELINE_NEFF.
 *
 * This is `channelCurve` up to v5.2. From v5.3 it is the first half of it: when it comes back
 * null, `channelCurve` estimates instead of giving up.
 */
export function measuredCurveAt(
  priors: readonly CurvePrior[],
  targetAge: number,
  params: GlobalParams,
  halfLife?: number
): CurveResult {
  const hl = halfLife ?? kernelHalfLifeForPriors(priors);
  const contributions: Contribution[] = [];
  for (const p of priors) {
    const c = contributionAt(p, targetAge, params);
    if (c) contributions.push({ ...c, weight: baselineWeight(p.ageDays, hl) });
  }
  const ws = contributions.map((c) => c.weight);
  const neff = effectiveN(ws);
  const nReal = contributions.filter((c) => c.kind === 'real').length;
  const measuredShare = contributions.length ? nReal / contributions.length : 0;
  const base = { kind: 'measured' as const, anchorAge: null, n: contributions.length, neff, measuredShare, contributions };
  if (contributions.length < MIN_BASELINE_PRIORS || neff < MIN_BASELINE_NEFF) {
    return { typical: null, ...base };
  }
  const m = weightedMedian(contributions.map((c) => Math.log(c.views)), ws);
  return { typical: m == null ? null : Math.exp(m), ...base };
}

/**
 * C(t) -- what a normal video on this channel has at age t. v5.3.
 *
 * WHY THIS CHANGED. Up to v5.2 this returned null whenever fewer than three priors could
 * contribute AT t, and on most channels that is every age under about a day: launch sampling
 * only began 2026-09-01, so a prior published before then has no reading in its own first hours,
 * and the sub-day rule (lifetime counts excluded under a day; a slide allowed only from a sample
 * younger than SUBDAY_SLIDE_MAX_AGE) correctly refuses to invent one. The consequence was not a
 * missing prior, it was a missing ANSWER: the video page's "typical for this channel" line began
 * at day 1 with nothing to its left, and every sub-day score was null. But a channel that has a
 * level at day 3 has a level at hour 12 -- we know the shape of the first day from the global
 * growth curve even when this channel never sat still to be measured there. Refusing to say so
 * is not caution, it is silence with the same face as ignorance.
 *
 * So: measured where measured, estimated everywhere else, and the difference is CARRIED
 * (`kind`, `anchorAge`, `measuredShare`) rather than hidden -- the chart draws an estimated
 * stretch dotted, the row stores which it was. Null survives for exactly one case: a channel
 * with no level at ANY age on the ladder, i.e. no scored priors at all.
 */
export function channelCurve(
  priors: readonly CurvePrior[],
  targetAge: number,
  params: GlobalParams,
  halfLife?: number
): CurveResult {
  // Omitted means "this channel's own rhythm" -- the production rule since v5.2. The backtest
  // harnesses pass an explicit half-life to hold the kernel fixed as a control.
  const hl = halfLife ?? kernelHalfLifeForPriors(priors);
  const measured = measuredCurveAt(priors, targetAge, params, hl);
  if (measured.typical != null) return measured;

  for (const anchor of estimateLadder(targetAge)) {
    const at = measuredCurveAt(priors, anchor, params, hl);
    if (at.typical == null) continue;
    const { log } = estimateSlideLog(priors, anchor, targetAge, params);
    const typical = at.typical * Math.exp(log);
    if (!(typical > 0) || !Number.isFinite(typical)) continue;
    return {
      typical, kind: 'estimated', anchorAge: anchor,
      // n and neff describe the ANCHOR -- the only place this channel was actually measured.
      n: at.n, neff: at.neff,
      // Nothing here was measured at t. Saying otherwise would let a page claim a sub-day
      // denominator came from readings that do not exist.
      measuredShare: 0,
      contributions: at.contributions,
    };
  }
  // No level anywhere on the ladder: this channel has no scored history. The only null.
  return measured;
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
  /** Whether typicalAtAge was measured at this age or slid from `typicalAnchorAge`. */
  typicalKind: TypicalKind;
  /** The age C was measured at when `typicalKind` is 'estimated'; null when measured. */
  typicalAnchorAge: number | null;
  /** v̂(T) along G from the latest reading. */
  projection: number;
  projectionHorizon: number;
  q: number | null;
  confidence: 'insufficient' | 'early' | 'likely' | 'confirmed';
  /**
   * True when age < growth.AGE_FLOOR_HOURS. From v5.3 this NO LONGER withholds the score --
   * it is a confidence fact ('early'), not an absence. G's reconstruction error under four
   * hours is large, and the honest way to say so is a word on the number, not a blank where
   * the number goes.
   */
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
  // Under AGE_FLOOR_HOURS, G's own reconstruction error is large (leave-one-out medALE 1.60
  // under an hour). Up to v5.2 that withheld the ratio entirely. v5.3 computes it and SAYS SO
  // instead -- confidence 'early' -- because a reader who is shown nothing concludes the product
  // is broken, while a reader shown a number marked early can decide what it is worth.
  const tooYoung = belowAgeFloor(inp.age);
  const score = c.typical && c.typical > 0 ? inp.vt / c.typical : null;
  const confidence: V5Output['confidence'] =
    tooYoung ? 'early'
    // A null curve now means the channel has NO level at any age -- no scored priors at all --
    // so 'insufficient' is the truth about the channel at every age, including under a day.
    : c.typical == null ? 'insufficient'
    : inp.age < 3 ? 'early' : inp.age < 7 ? 'likely' : 'confirmed';
  return {
    score, ageDays: inp.age, typicalAtAge: c.typical,
    typicalAt30: c30.typical,
    nTypical: c.n, typicalNeff: c.neff,
    typicalMeasuredShare: c.measuredShare,
    typicalKind: c.kind, typicalAnchorAge: c.anchorAge,
    projection, projectionHorizon: horizon, q, confidence,
    belowAgeFloor: tooYoung,
  };
}

