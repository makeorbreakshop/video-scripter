// Production scoring math (model v3, 2026-09-02). Pure functions, no I/O.
//
// Answers "is this video outperforming for THIS channel, at this point in its life?" with:
//   sameAgeRatio  = v_t / median(v_t of the channel's last <=10 prior videos at the same age)
//   est30         = v_t * exp( remaining growth ), where remaining growth blends
//                   the channel's own growth multiplier with the global one by n/(n+k),
//                   plus a per-video correction from the video's growth exponent Q
//                   (log growth between its first and latest snapshot, read at TRUE age)
//   score         = est30 / channelBaseline (time-weighted median in LOG space of the day-30
//                   estimates of the last <=15 fresh priors; weight 2^(-ageDays/30) -- v4.0)
//   confidence    = early (<3d) | likely (3-6d) | confirmed (>=7d), 'insufficient' when priors < 3
// Validated in the 2026-09-01 backtests (harness v2): same-age ratio ranks at rho .87 by day 3;
// v3 blend medALE ~.30 day 1, ~.19 day 3, ~.10 day 7 on held-out time.

export const MODEL_VERSION = 'v5.0';
export const DAY_BUCKETS = [1, 2, 3, 5, 7, 14, 21, 30] as const;
export type DayBucket = (typeof DAY_BUCKETS)[number];
// Launch ladder: sub-day buckets (in days) fitted from the 5-minute launch samples, chained
// through day 1 -> mult[h] = median log(v_day1 / v_h) + mult[1]. See fitLaunchLadder.
export const HOUR_BUCKETS = [1 / 24, 2 / 24, 4 / 24, 8 / 24, 12 / 24, 18 / 24] as const;
export const ALL_BUCKETS: readonly number[] = [...HOUR_BUCKETS, ...DAY_BUCKETS];

export interface Snapshot { day: number; views: number }          // day = days since publish (float ok)
export interface GlobalParams {
  // median log(v30 / v_t) per day bucket, fit from the last 12 months
  mult: Record<number, number>;
  // per day bucket: Q quantile edges and the median residual log-error in each bin
  qBins: Record<number, { edges: number[]; resid: number[] }>;
  // long-tail table: median lifetime_views / v30 by age bucket (see fitLongTail)
  longtail?: LongtailTable;
  fittedAt: string;
  nVideos: number;
}

// Age buckets (days since publish) for the long-tail multiplier. The last one is open-ended.
export const LONGTAIL_AGES = [60, 90, 180, 365, 730, 1500] as const;

// mult[i] is the median lifetime_views / v30 for videos whose age falls in bucket i;
// monotone non-decreasing and >= 1 (a video never loses views). n[i] is the fit support.
export interface LongtailTable { ages: number[]; mult: number[]; n: number[] }

export const K_SHRINK = (t: number) => (t <= 2 ? 2 : 1);

// Nearest fitted bucket. From day 1 on, nearest in days (the validated v3 behaviour). Inside
// the first day, nearest in log-age so 3h snaps to the 4h bucket rather than to day 1. Only
// buckets present in `available` count, so an unfitted hour ladder falls back to day 1.
export function bucketFor(day: number, available: readonly number[] = ALL_BUCKETS): number {
  const d = Math.max(day, 1 / 48);
  const pool = d >= 1 ? available.filter((b) => b >= 1) : available;
  const cands = pool.length ? pool : available;
  const dist = (b: number) => (d >= 1 ? Math.abs(b - d) : Math.abs(Math.log(b) - Math.log(d)));
  let best = cands[0];
  for (const b of cands) if (dist(b) < dist(best)) best = b;
  return best;
}

/** Buckets a params table actually has multipliers for (hour buckets appear once fitted). */
export function fittedBuckets(params: GlobalParams): number[] {
  return ALL_BUCKETS.filter((b) => params.mult[b] != null);
}

/** Snapshot-matching tolerance (days) around a bucket: a quarter of the age inside day 1. */
export function bucketTolerance(bucket: number): number {
  if (bucket < 1) return Math.max(bucket * 0.25, 1 / 48);
  return bucket <= 3 ? 1 : bucket <= 7 ? 2 : 3;
}

export function median(xs: number[]): number | null {
  const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// Growth exponent from the video's own record (power law in (day+1)); null with <2 usable points.
export function growthExponent(snaps: Snapshot[]): number | null {
  const s = snaps.filter((x) => x.views > 0 && x.day >= 0).sort((a, b) => a.day - b.day);
  if (s.length < 2) return null;
  const f = s[0], l = s[s.length - 1];
  if (l.day <= f.day) return null;
  return Math.log(l.views / f.views) / Math.log((l.day + 1) / (f.day + 1));
}

export function qResidual(params: GlobalParams, bucket: number, q: number | null): number {
  if (q == null) return 0;
  const b = params.qBins[bucket];
  if (!b || !b.edges.length) return 0;
  let i = 0;
  while (i < b.edges.length && q > b.edges[i]) i++;
  return b.resid[Math.min(i, b.resid.length - 1)] ?? 0;
}

export interface ScoreInput {
  vt: number;                 // latest views
  day: number;                // TRUE age at that snapshot (days since publish)
  snaps: Snapshot[];          // the video's own record up to now
  priorMultLogs: number[];    // channel priors: log(v30 / v_t) at ~this bucket (<=10)
  priorV30: number[];         // channel priors: day-30 estimates, newest first (<=PRIOR_WINDOW)
  /** Age in days of each `priorV30` entry: target publish time minus that prior's publish time. */
  priorAgeDays: number[];
  priorSameAge: number[];     // channel priors: views at the same age (<=10)
  priorsFromLifetime?: number; // how many of priorV30 came from lifetime/long-tail normalization
  priorsProjected?: number;    // how many of priorV30 were projected forward from before day 30
  params: GlobalParams;
}

export interface ScoreOutput {
  bucket: number;
  q: number | null;
  est30: number;
  baseline: number | null;
  nBaseline: number;
  /** Effective prior count behind the baseline: (sum w)^2 / sum w^2. */
  baselineNeff: number;
  score: number | null;
  sameAgeRatio: number | null;
  nSameAge: number;
  priorsFromLifetime: number;
  priorsProjected: number;
  confidence: 'insufficient' | 'early' | 'likely' | 'confirmed';
}

export function scoreVideo(inp: ScoreInput): ScoreOutput {
  const bucket = bucketFor(inp.day, fittedBuckets(inp.params));
  const g = inp.params.mult[bucket] ?? 0;
  const n = inp.priorMultLogs.length;
  const chm = n ? median(inp.priorMultLogs)! : g;
  const w = n / (n + K_SHRINK(bucket));
  const q = growthExponent(inp.snaps);
  const remaining = w * chm + (1 - w) * g + qResidual(inp.params, bucket, q);
  // day-30+ videos: no growth left to project relative to the day-30 definition
  const est30 = inp.day >= 30 ? inp.vt : inp.vt * Math.exp(remaining);
  const b = channelBaseline(inp.priorV30, inp.priorAgeDays);
  const baseline = b.baseline;
  const sameMed = inp.priorSameAge.length >= 3 ? median(inp.priorSameAge) : null;
  const score = baseline && baseline > 0 ? est30 / baseline : null;
  const sameAgeRatio = sameMed && sameMed > 0 ? inp.vt / sameMed : null;
  // No baseline (too few priors, or too little effective weight behind them) means we do not
  // claim to know how the channel performs.
  const confidence =
    baseline == null ? 'insufficient' : inp.day < 3 ? 'early' : inp.day < 7 ? 'likely' : 'confirmed';
  return {
    bucket, q, est30, baseline, nBaseline: inp.priorV30.length, baselineNeff: b.neff, score, sameAgeRatio,
    nSameAge: inp.priorSameAge.length, priorsFromLifetime: inp.priorsFromLifetime ?? 0,
    priorsProjected: inp.priorsProjected ?? 0, confidence,
  };
}

// ---- fitting (used by the nightly --fit) ----
export interface FitRow { bucket: number; vt: number; v30: number; q: number | null }

/**
 * Launch ladder. Inside the first day no video has a day-30 truth yet (sampling began
 * 2026-09-01), but thousands have a day-1 count, and day 1 -> 30 is already fitted. So each
 * hour bucket is chained: mult[h] = median log(v_day1 / v_h) + mult[1]. Buckets with fewer
 * than `minRows` observations are left out (the scorer then falls back to the day-1 bucket).
 * Monotone: an earlier hour never has less growth left than a later one.
 */
export interface LaunchRow { hours: number; vh: number; v1: number }
export function fitLaunchLadder(rows: LaunchRow[], day1Mult: number, minRows = 50): { mult: Record<number, number>; n: Record<number, number> } {
  const mult: Record<number, number> = {}; const n: Record<number, number> = {};
  const fitted: number[] = [];
  for (const b of HOUR_BUCKETS) {
    const hb = b * 24; const tol = Math.max(hb * 0.15, 0.25);
    const rs = rows.filter((r) => r.vh > 0 && r.v1 > 0 && Math.abs(r.hours - hb) <= tol);
    n[b] = rs.length;
    if (rs.length < minRows) continue;
    const m = median(rs.map((r) => Math.log(r.v1 / r.vh)))! + day1Mult;
    mult[b] = Math.max(m, day1Mult); // never less growth left than at day 1
    fitted.push(b);
  }
  // monotone non-increasing in age: walk from the latest hour back to the earliest
  for (let i = fitted.length - 2; i >= 0; i--) mult[fitted[i]] = Math.max(mult[fitted[i]], mult[fitted[i + 1]]);
  return { mult, n };
}

export function fitParams(rows: FitRow[], fittedAt = new Date().toISOString()): GlobalParams {
  const mult: Record<number, number> = {};
  const qBins: GlobalParams['qBins'] = {};
  for (const b of DAY_BUCKETS) {
    const rs = rows.filter((r) => r.bucket === b && r.vt > 0 && r.v30 > 0);
    const logs = rs.map((r) => Math.log(r.v30 / r.vt));
    mult[b] = median(logs) ?? 0;
    const withQ = rs.filter((r) => r.q != null && Number.isFinite(r.q!));
    if (withQ.length >= 50) {
      const qs = withQ.map((r) => r.q!).sort((a, c) => a - c);
      const edges = [0.2, 0.4, 0.6, 0.8].map((p) => qs[Math.floor(p * (qs.length - 1))]);
      const resid: number[] = [];
      for (let i = 0; i <= edges.length; i++) {
        const inBin = withQ.filter((r) => {
          const q = r.q!;
          const lo = i === 0 ? -Infinity : edges[i - 1];
          const hi = i === edges.length ? Infinity : edges[i];
          return q > lo && q <= hi;
        });
        resid.push(median(inBin.map((r) => Math.log(r.v30 / r.vt) - mult[b])) ?? 0);
      }
      // enforce monotone non-decreasing residuals in Q (higher exponent => more growth left)
      for (let i = 1; i < resid.length; i++) resid[i] = Math.max(resid[i], resid[i - 1]);
      qBins[b] = { edges, resid };
    } else {
      qBins[b] = { edges: [], resid: [] };
    }
  }
  return { mult, qBins, fittedAt, nVideos: rows.length };
}

// ---- long tail (used by --fit and by --final / sparse-channel baselines) ----
//
// Most channels are not densely tracked, so a prior video often has no day-27..33 snapshot --
// only a current lifetime view_count. The long-tail table converts one into the other:
// for videos that have BOTH a day-30 truth and a current count, the median lifetime/v30 by age.
// It is monotone non-decreasing in age and never below 1.
export interface LongtailRow { age: number; v30: number; lifetime: number }

export function longtailBucket(age: number, ages: readonly number[] = LONGTAIL_AGES): number {
  let i = -1;
  for (let k = 0; k < ages.length; k++) if (age >= ages[k]) i = k;
  return i; // -1 when younger than the first bucket
}

export function fitLongTail(rows: LongtailRow[], ages: readonly number[] = LONGTAIL_AGES, minRows = 20): LongtailTable {
  const mult: number[] = [];
  const n: number[] = [];
  let last = 1;
  for (let i = 0; i < ages.length; i++) {
    const rs = rows.filter(
      (r) => r.v30 > 0 && r.lifetime > 0 && Number.isFinite(r.age) && longtailBucket(r.age, ages) === i
    );
    n.push(rs.length);
    const m = rs.length >= minRows ? median(rs.map((r) => r.lifetime / r.v30)) : null;
    // thin buckets carry the previous value forward; monotone and never below 1
    last = Math.max(m ?? last, last, 1);
    mult.push(last);
  }
  return { ages: [...ages], mult, n };
}

// Multiplier at an arbitrary age: log-linear between bucket edges, clamped at both ends.
export function longtailAt(t: LongtailTable | undefined | null, age: number): number {
  if (!t || !t.ages.length || !t.mult.length) return 1;
  if (!(age > 0)) return t.mult[0];
  if (age <= t.ages[0]) return t.mult[0];
  const lastI = t.ages.length - 1;
  if (age >= t.ages[lastI]) return t.mult[lastI];
  for (let i = 1; i <= lastI; i++) {
    if (age <= t.ages[i]) {
      const x0 = Math.log(t.ages[i - 1]), x1 = Math.log(t.ages[i]), x = Math.log(age);
      return t.mult[i - 1] + ((t.mult[i] - t.mult[i - 1]) * (x - x0)) / (x1 - x0);
    }
  }
  return t.mult[lastI];
}

// Minimum age at which a lifetime count may stand in for a day-30 snapshot.
export const MIN_LIFETIME_AGE = 45;

// ---- prior day-30 estimation for the channel baseline (2026-09-03) ----
//
// A channel baseline is the median day-30 views of its recent prior videos. Until now a prior
// only counted with a real day-27..33 snapshot, or a lifetime count once it passed
// MIN_LIFETIME_AGE. On a channel that uploads every day or two, the last 10 priors are all
// younger than that, so NO prior qualified and the baseline came out null -- the page then said
// "not enough history" for exactly the channels users watch most.
//
// Every observation is a point on a trajectory, and the fitted tables translate any of them to
// day 30. So a prior contributes its day-30 estimate three ways, best first:
//   real       a day-27..33 snapshot                      (no translation error)
//   lifetime   past day 30, divided down the long tail     (small)
//   projected  before day 30, multiplied UP the growth curve (largest, and age-dependent)
//
// Validated by scripts/backtest-baseline.ts on 2,753 videos from Jul-Aug 2025 with strict
// walk-forward censoring. At day 3, all channels: coverage .50 -> .99, baseline medALE
// .270 -> .102, score medALE .393 -> .213, outlier F1 .65 -> .75. Daily-cadence channels go
// from 8% covered to ~100% and post the lowest baseline error of any group, so projecting
// young priors is sound. The lone regression was sparse-cadence channels (F1 .70 -> .65 at
// day 3), traced NOT to projection (under 10% of their priors) but to the wider prior window
// dragging in stale history -- hence PRIOR_WINDOW_SPARSE and PRIOR_STALE_DAYS below.

/** A prior younger than this is too noisy to project to day 30 (the day-1 multiplier is ~2.3x). */
export const MIN_PROJECT_AGE = 2;
/** Prior window: wider by default, narrower on channels that publish rarely. */
export const PRIOR_WINDOW = 15;
export const PRIOR_WINDOW_SPARSE = 10;
/** Median publish gap above which a channel counts as sparse. */
export const SPARSE_GAP_DAYS = 9;
/** A prior older than this says little about how the channel performs now. */
export const PRIOR_STALE_DAYS = 550;

export type PriorKind = 'real' | 'lifetime' | 'projected';
export interface PriorEstimate { v30: number; kind: PriorKind }

/**
 * Log multiplier from views at `day` up to day 30, interpolated log-linearly between the
 * fitted day buckets. Zero at day 30 and beyond (no growth left to project).
 */
export function logMultTo30(params: GlobalParams, day: number): number {
  const b = DAY_BUCKETS as readonly number[];
  const m = (k: number) => params.mult[k] ?? 0;
  if (!(day > 0)) return m(b[0]);
  if (day <= b[0]) return m(b[0]);
  if (day >= 30) return 0;
  for (let i = 1; i < b.length; i++) {
    if (day <= b[i]) {
      const x0 = Math.log(b[i - 1]), x1 = Math.log(b[i]), x = Math.log(day);
      return m(b[i - 1]) + ((m(b[i]) - m(b[i - 1])) * (x - x0)) / (x1 - x0);
    }
  }
  return 0;
}

/**
 * Long-tail multiplier for an age between 30 and the table's first bucket (60d), where
 * `longtailAt` would otherwise clamp to the 60-day value and overstate the tail. Ramps
 * linearly from 1.0 at day 30 to the fitted 60-day multiplier.
 */
export function longtailFrom30(lt: LongtailTable | undefined | null, age: number): number {
  const first = lt?.ages?.[0] ?? 60;
  if (age >= first) return longtailAt(lt, age);
  if (age <= 30) return 1;
  const m = longtailAt(lt, first);
  return 1 + (m - 1) * ((age - 30) / (first - 30));
}

/**
 * Day-30 estimate for one prior video from its own record. `snapDay` is the age at the latest
 * snapshot, which is what both translations are keyed to -- NOT the prior's age today, which
 * would over-divide a stale snapshot down the long tail.
 */
export function priorV30(
  realV30: number | null | undefined,
  latest: Snapshot | null | undefined,
  params: GlobalParams,
  minProjectAge = MIN_PROJECT_AGE
): PriorEstimate | null {
  if (realV30 != null && realV30 > 0 && Number.isFinite(realV30)) return { v30: realV30, kind: 'real' };
  if (!latest || !(latest.views > 0) || !Number.isFinite(latest.day)) return null;
  if (latest.day >= 30) {
    const m = longtailFrom30(params.longtail, latest.day);
    return m > 0 ? { v30: latest.views / m, kind: 'lifetime' } : null;
  }
  if (latest.day < minProjectAge) return null;
  return { v30: latest.views * Math.exp(logMultTo30(params, latest.day)), kind: 'projected' };
}

/** Median gap in days between consecutive publish times; null with fewer than 3. */
export function publishGapDays(publishedAtMs: number[]): number | null {
  if (publishedAtMs.length < 3) return null;
  const p = [...publishedAtMs].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < p.length; i++) gaps.push((p[i] - p[i - 1]) / 86_400_000);
  return median(gaps);
}

/**
 * How many recent priors feed the est30 side (`priorMultLogs`, `priorSameAge`). Sparse channels
 * keep the narrower window: reaching further back only added stale history (the one F1
 * regression in the 2026-09-03 backtest). Since v4.0 the BASELINE no longer uses this -- it
 * takes up to PRIOR_WINDOW fresh priors and lets the age kernel handle staleness.
 */
export function priorWindow(gapDays: number | null): number {
  return gapDays != null && gapDays > SPARSE_GAP_DAYS ? PRIOR_WINDOW_SPARSE : PRIOR_WINDOW;
}

// ---- the channel baseline (model v4.0, 2026-09-04) ----
//
// v3 took the plain median of the priors' day-30 estimates over `priorWindow(cadence)` of them.
// That treats a video from last week and one from a year ago as equally informative, so a
// channel whose level has moved carries stale history into today's denominator. v4 replaces the
// combination (only the combination -- `priorV30` and the est30 side are untouched) with an
// exponentially time-weighted median in LOG space over up to PRIOR_WINDOW fresh priors:
//
//   w_i      = 2^(-ageDays_i / BASELINE_HALF_LIFE_DAYS)     ageDays = target pub - prior pub
//   baseline = exp( weightedMedian( log v30_i, w_i ) )
//
// Log space because view counts are log-normal and the kernel's tie-break should be a geometric
// mean, not an arithmetic one. A median rather than a weighted mean so one freak prior cannot
// move the denominator. The kernel also makes PRIOR_WINDOW_SPARSE redundant for the baseline: a
// sparse channel's older priors are down-weighted by age instead of truncated by count, which is
// where most of the gain landed (baseline medALE .290 -> .171 on sparse channels at t=1).
//
// Validated by scripts/backtest-baseline-trend.ts (2026-09-04, 4,000 holdout videos Jul-Aug 2025,
// centered oracle): at t=7 baseline medALE .171 -> .131 all-slice, outlier F1 .72 -> .76, and
// all-slice bias .043 -> ~0. See docs/benchmarks/baseline-trend-run3-controls.txt.

/** A prior published this many days before the target counts half as much. */
export const BASELINE_HALF_LIFE_DAYS = 30;
/** A baseline needs at least this many usable priors ... */
export const MIN_BASELINE_PRIORS = 3;
/** ... and this much effective sample size once they are weighted. */
export const MIN_BASELINE_NEFF = 2;

/** Kernel weight for a prior published `ageDays` before the target. */
export function baselineWeight(ageDays: number, halfLife = BASELINE_HALF_LIFE_DAYS): number {
  const a = Number.isFinite(ageDays) ? Math.max(ageDays, 0) : 0;
  return Math.pow(2, -a / halfLife);
}

/** Effective sample size of a weight vector: (sum w)^2 / sum w^2. n for equal weights. */
export function effectiveN(ws: number[]): number {
  let s = 0, s2 = 0;
  for (const w of ws) { if (w > 0 && Number.isFinite(w)) { s += w; s2 += w * w; } }
  return s2 > 0 ? (s * s) / s2 : 0;
}

/**
 * Weighted median: the value at which the cumulative weight crosses half the total. Landing
 * exactly on the halfway mark averages across the tie, so equal weights reduce to `median`
 * (including the two-middle-values case on an even count). Null when nothing is usable.
 */
export function weightedMedian(xs: number[], ws: number[]): number | null {
  const idx = xs.map((_, i) => i)
    .filter((i) => Number.isFinite(xs[i]) && ws[i] > 0 && Number.isFinite(ws[i]))
    .sort((a, b) => xs[a] - xs[b]);
  if (!idx.length) return null;
  const tot = idx.reduce((sum, i) => sum + ws[i], 0);
  const half = tot / 2;
  const eps = tot * 1e-12;
  let acc = 0;
  for (let k = 0; k < idx.length; k++) {
    acc += ws[idx[k]];
    if (acc >= half - eps) {
      if (Math.abs(acc - half) <= eps && k + 1 < idx.length) return (xs[idx[k]] + xs[idx[k + 1]]) / 2;
      return xs[idx[k]];
    }
  }
  return xs[idx[idx.length - 1]];
}

export interface BaselineResult {
  /** Time-weighted geometric baseline, or null when the floors are not met. */
  baseline: number | null;
  /** Priors that produced a usable day-30 estimate. */
  nPriors: number;
  /** Effective prior count after weighting. */
  neff: number;
}

/**
 * The channel baseline. `priorV30[i]` is a prior's day-30 estimate and `priorAgeDays[i]` is how
 * many days before the TARGET's publish time that prior was published. A missing or non-finite
 * age counts as age 0 (full weight). Returns null unless there are >= MIN_BASELINE_PRIORS priors
 * AND effective n >= MIN_BASELINE_NEFF -- one recent prior plus a tail of near-zero weights is
 * not a channel history.
 */
export function channelBaseline(
  priorV30: readonly number[],
  priorAgeDays: readonly number[],
  halfLife = BASELINE_HALF_LIFE_DAYS
): BaselineResult {
  const logs: number[] = [];
  const ws: number[] = [];
  for (let i = 0; i < priorV30.length; i++) {
    const v = priorV30[i];
    if (!(v > 0) || !Number.isFinite(v)) continue;
    logs.push(Math.log(v));
    ws.push(baselineWeight(priorAgeDays[i], halfLife));
  }
  const neff = effectiveN(ws);
  if (logs.length < MIN_BASELINE_PRIORS || neff < MIN_BASELINE_NEFF) {
    return { baseline: null, nPriors: logs.length, neff };
  }
  const m = weightedMedian(logs, ws);
  return { baseline: m == null ? null : Math.exp(m), nPriors: logs.length, neff };
}

export interface V30Estimate { v30: number; fromLifetime: boolean }

// Day-30 views for any video: the real snapshot when we have one, else the current
// lifetime count divided back down the long-tail curve. Null when neither applies.
export function estimateV30(
  snapshotV30: number | null | undefined,
  viewCount: number | null | undefined,
  ageDays: number,
  longtail: LongtailTable | undefined | null,
  minAge = MIN_LIFETIME_AGE
): V30Estimate | null {
  if (snapshotV30 != null && snapshotV30 > 0 && Number.isFinite(snapshotV30)) {
    return { v30: snapshotV30, fromLifetime: false };
  }
  if (viewCount != null && viewCount > 0 && Number.isFinite(viewCount) && ageDays >= minAge) {
    const m = longtailAt(longtail, ageDays);
    if (m > 0) return { v30: viewCount / m, fromLifetime: true };
  }
  return null;
}
