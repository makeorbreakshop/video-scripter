/**
 * Score the scorer.
 *
 * Every row in `video_score_history` is a claim made at a known age: at day t this video was
 * heading for `est30` views and was running at `score`x its channel. Thirty days later the
 * count is simply known. This turns the pile of old claims into a grade, cut the ways a
 * disagreement would actually show up: by age, by channel size, by the confidence word the app
 * printed next to the number, by whether C(t) was measured or estimated (v5.3's slide), and by
 * whether the packaging changed after the claim was made.
 *
 * Pure. scripts/scorecard-refresh.ts fetches the rows and writes the output; the arithmetic and
 * the bucket boundaries are here so they can be tested and read without a database.
 */

export const AGE_BUCKETS = [0.5, 1, 2, 3, 5, 7, 14] as const;
export const OUTLIER_THRESHOLD = 2;

/** One historical claim paired with the outcome that settled it. */
export interface ScorecardRow {
  videoId: string;
  /** The age bucket this claim was filed under (nearest AGE_BUCKETS entry within tolerance). */
  t: number;
  /** The claim's real age in days — the bucket is a label, this is the fact. */
  ageDays: number;
  est30: number;
  actual30: number;
  /** The score shown at age t, and the denominator it was over. Either may be missing. */
  score: number | null;
  baseline: number | null;
  confidence: string | null;
  /** v5.3: 'measured' or 'estimated'. Null on rows written before the column existed. */
  typicalKind: string | null;
  subscribers: number | null;
  /** True when packaging changed between the claim and day 30. Null when coverage is missing. */
  changedAfter: boolean | null;
}

export interface Metrics {
  n: number;
  medALE: number | null;
  bias: number | null;
  /** Outlier call at t vs the truth actual30/baseline >= 2. */
  calls: number;
  truths: number;
  tp: number;
  fp: number;
  fn: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  /** How many rows could be graded for the call at all (need a baseline). */
  nCallable: number;
}

export interface ScorecardCell { dimension: string; bucket: string; metrics: Metrics }

export function median(xs: number[]): number | null {
  const a = xs.filter(Number.isFinite).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Rows a point-error number may be computed from. */
export const usable = (rows: ScorecardRow[]): ScorecardRow[] =>
  rows.filter((r) => r.est30 > 0 && r.actual30 > 0);

export function metricsFor(rows: ScorecardRow[]): Metrics {
  const ok = usable(rows);
  const errs = ok.map((r) => Math.log(r.est30 / r.actual30));
  let tp = 0, fp = 0, fn = 0, nCallable = 0;
  for (const r of ok) {
    if (r.score == null || r.baseline == null || !(r.baseline > 0)) continue;
    nCallable++;
    const called = r.score >= OUTLIER_THRESHOLD;
    const truth = r.actual30 / r.baseline >= OUTLIER_THRESHOLD;
    if (called && truth) tp++; else if (called) fp++; else if (truth) fn++;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const f1 = precision != null && recall != null && precision + recall > 0
    ? (2 * precision * recall) / (precision + recall) : null;
  return {
    n: ok.length,
    medALE: median(errs.map(Math.abs)),
    bias: median(errs),
    calls: tp + fp, truths: tp + fn, tp, fp, fn, precision, recall, f1, nCallable,
  };
}

// ------------------------------------------------------------------- dimensions

/** Subscriber bands. Boundaries are the ones the product already talks in, not quantiles. */
export function sizeBucket(subs: number | null | undefined): string {
  if (subs == null || !Number.isFinite(subs)) return 'unknown';
  if (subs < 1_000) return '<1K';
  if (subs < 10_000) return '1K–10K';
  if (subs < 100_000) return '10K–100K';
  if (subs < 1_000_000) return '100K–1M';
  return '1M+';
}

export const SIZE_ORDER = ['<1K', '1K–10K', '10K–100K', '100K–1M', '1M+', 'unknown'];
export const CONFIDENCE_ORDER = ['insufficient', 'early', 'likely', 'confirmed', 'unknown'];

/**
 * Packaging stratum. `no_change` here means "no change we observed", which before the CDN
 * watcher's 2026-09-01 first-capture pass is not the same thing as unchanged — a row whose
 * coverage is missing is `unknown`, not `no_change`.
 */
export function packagingBucket(changedAfter: boolean | null): string {
  if (changedAfter == null) return 'unknown';
  return changedAfter ? 'changed' : 'no_change';
}

const bucketers: Record<string, (r: ScorecardRow) => string> = {
  age: (r) => String(r.t),
  channel_size: (r) => sizeBucket(r.subscribers),
  confidence: (r) => r.confidence ?? 'unknown',
  typical_kind: (r) => r.typicalKind ?? 'unknown',
  packaging: (r) => packagingBucket(r.changedAfter),
};

export const DIMENSIONS = Object.keys(bucketers);

const ORDERS: Record<string, string[]> = {
  age: AGE_BUCKETS.map(String),
  channel_size: SIZE_ORDER,
  confidence: CONFIDENCE_ORDER,
  typical_kind: ['measured', 'estimated', 'unknown'],
  packaging: ['no_change', 'changed', 'unknown'],
};

/** Every (dimension, bucket) cell, in the order the page should print them. */
export function buildScorecard(rows: ScorecardRow[]): ScorecardCell[] {
  const out: ScorecardCell[] = [];
  for (const dimension of DIMENSIONS) {
    const by = new Map<string, ScorecardRow[]>();
    for (const r of rows) {
      const b = bucketers[dimension](r);
      const a = by.get(b);
      if (a) a.push(r); else by.set(b, [r]);
    }
    const order = ORDERS[dimension] ?? [];
    const keys = [...by.keys()].sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return a.localeCompare(b);
    });
    for (const bucket of keys) out.push({ dimension, bucket, metrics: metricsFor(by.get(bucket)!) });
  }
  return out;
}

/** The bucket a claim at `ageDays` belongs to, or null when it is not near any of them. */
export function bucketForAge(ageDays: number): number | null {
  let best: number | null = null, bestD = Infinity;
  for (const b of AGE_BUCKETS) {
    const tol = ageTolerance(b);
    const d = Math.abs(ageDays - b);
    if (d <= tol && d < bestD) { best = b; bestD = d; }
  }
  return best;
}

/** The benchmark's own tolerance ladder, so the scorecard's ages mean the same thing. */
export const ageTolerance = (t: number): number => (t < 1 ? t * 0.5 : t <= 3 ? 1 : t <= 7 ? 2 : 3);
