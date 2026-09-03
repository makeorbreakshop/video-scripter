// Production scoring math (model v3, 2026-09-02). Pure functions, no I/O.
//
// Answers "is this video outperforming for THIS channel, at this point in its life?" with:
//   sameAgeRatio  = v_t / median(v_t of the channel's last <=10 prior videos at the same age)
//   est30         = v_t * exp( remaining growth ), where remaining growth blends
//                   the channel's own growth multiplier with the global one by n/(n+k),
//                   plus a per-video correction from the video's growth exponent Q
//                   (log growth between its first and latest snapshot, read at TRUE age)
//   score         = est30 / channelBaseline (median day-30 views of the last <=10 priors)
//   confidence    = early (<3d) | likely (3-6d) | confirmed (>=7d), 'insufficient' when priors < 3
// Validated in the 2026-09-01 backtests (harness v2): same-age ratio ranks at rho .87 by day 3;
// v3 blend medALE ~.30 day 1, ~.19 day 3, ~.10 day 7 on held-out time.

export const MODEL_VERSION = 'v3.0';
export const DAY_BUCKETS = [1, 2, 3, 5, 7, 14, 21, 30] as const;
export type DayBucket = (typeof DAY_BUCKETS)[number];

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

export function bucketFor(day: number): DayBucket {
  let best: DayBucket = DAY_BUCKETS[0];
  for (const b of DAY_BUCKETS) if (Math.abs(b - day) < Math.abs(best - day)) best = b;
  return best;
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
  priorV30: number[];         // channel priors: day-30 views (<=10)
  priorSameAge: number[];     // channel priors: views at the same age (<=10)
  priorsFromLifetime?: number; // how many of priorV30 came from lifetime/long-tail normalization
  priorsProjected?: number;    // how many of priorV30 were projected forward from before day 30
  params: GlobalParams;
}

export interface ScoreOutput {
  bucket: DayBucket;
  q: number | null;
  est30: number;
  baseline: number | null;
  nBaseline: number;
  score: number | null;
  sameAgeRatio: number | null;
  nSameAge: number;
  priorsFromLifetime: number;
  priorsProjected: number;
  confidence: 'insufficient' | 'early' | 'likely' | 'confirmed';
}

export function scoreVideo(inp: ScoreInput): ScoreOutput {
  const bucket = bucketFor(inp.day);
  const g = inp.params.mult[bucket] ?? 0;
  const n = inp.priorMultLogs.length;
  const chm = n ? median(inp.priorMultLogs)! : g;
  const w = n / (n + K_SHRINK(bucket));
  const q = growthExponent(inp.snaps);
  const remaining = w * chm + (1 - w) * g + qResidual(inp.params, bucket, q);
  // day-30+ videos: no growth left to project relative to the day-30 definition
  const est30 = inp.day >= 30 ? inp.vt : inp.vt * Math.exp(remaining);
  const baseline = inp.priorV30.length >= 3 ? median(inp.priorV30) : null;
  const sameMed = inp.priorSameAge.length >= 3 ? median(inp.priorSameAge) : null;
  const score = baseline && baseline > 0 ? est30 / baseline : null;
  const sameAgeRatio = sameMed && sameMed > 0 ? inp.vt / sameMed : null;
  // A baseline needs >=3 priors; below that we do not claim to know how the channel performs.
  const confidence =
    inp.priorV30.length < 3 ? 'insufficient' : inp.day < 3 ? 'early' : inp.day < 7 ? 'likely' : 'confirmed';
  return {
    bucket, q, est30, baseline, nBaseline: inp.priorV30.length, score, sameAgeRatio,
    nSameAge: inp.priorSameAge.length, priorsFromLifetime: inp.priorsFromLifetime ?? 0,
    priorsProjected: inp.priorsProjected ?? 0, confidence,
  };
}

// ---- fitting (used by the nightly --fit) ----
export interface FitRow { bucket: number; vt: number; v30: number; q: number | null }

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
 * How many recent priors to use. Sparse channels keep the narrower window: they already had
 * full baseline coverage from the long-tail path, and reaching further back only added stale
 * history (the one F1 regression in the backtest).
 */
export function priorWindow(gapDays: number | null): number {
  return gapDays != null && gapDays > SPARSE_GAP_DAYS ? PRIOR_WINDOW_SPARSE : PRIOR_WINDOW;
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
