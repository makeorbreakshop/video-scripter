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
  fittedAt: string;
  nVideos: number;
}

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
  const confidence =
    score == null && sameAgeRatio == null ? 'insufficient' : inp.day < 3 ? 'early' : inp.day < 7 ? 'likely' : 'confirmed';
  return { bucket, q, est30, baseline, nBaseline: inp.priorV30.length, score, sameAgeRatio, nSameAge: inp.priorSameAge.length, confidence };
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
