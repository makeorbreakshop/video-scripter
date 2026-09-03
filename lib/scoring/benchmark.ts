// Scoring benchmark: pure metric math over replayed rows. No I/O, no DB.
//
// A BenchRow is one (video, age) replay produced by scripts/benchmark-scores.ts: the production
// scorer (lib/scoring/core.scoreVideo) run on only what was observable at age t, plus the truth.
// Everything here is a function of those rows, so the metrics are testable on fixtures and the
// same code compares two runs.
//
// Metric definitions (all logs natural):
//   medALE    median |log(est30 / actual30)|            point error
//   bias      median  log(est30 / actual30)             sign of the error; 0 is unbiased
//   outlier   precision/recall/F1 of (score_t >= 2) against (actual30 / baseline_t >= 2).
//             BOTH sides use the same walk-forward baseline, so the only difference between the
//             call and the truth is est30 vs actual30 -- the forecast is what is being scored,
//             not the baseline.
//   spearman  rank correlation of score_t vs truth ratio WITHIN a channel, over channels with
//             >= minPerChannel test videos; reported as the median channel rho. Ranking inside a
//             channel is what the outlier feed actually does.
//   calib     for each confidence word, the hit rate of its own >= 2x calls (precision) and the
//             base rate of true outliers among its rows.
//   stability median |log(score_t / score_{t+1})| over consecutive ages of the same video, on
//             pairs whose truth call (>= 2x) is the same at both ages. Churn on rows whose truth
//             never moved is the model changing its mind for nothing.

export interface BenchRow {
  videoId: string;
  channelId: string;
  split: string;             // 'heldout' | 'time'
  t: number;                 // nominal age bucket of the replay
  day: number;               // TRUE age of the observation used
  est30: number;
  actual30: number;
  baseline: number | null;   // walk-forward channel median day-30 at age t
  score: number | null;      // est30 / baseline
  confidence: string;
  q: number | null;
  /** How many priors backed the baseline, and how many of those were derived rather than measured. */
  nBaseline?: number;
  priorsDerived?: number;
  truthDay: number;          // TRUE age of the day-27..33 observation used as truth
  /** Packaging changes on this video, as ages in days since publish. Empty when none are known. */
  packaging: PackagingChange[];
  /**
   * Whether we can SEE this video's packaging history at all. The CDN watcher's first-capture
   * pass ran 2026-09-01; before that a thumbnail or title swap left no record. So a pre-Sep-1
   * video is 'none' and its `no_change` stratum means only "no change we observed" -- it
   * includes every unseen swap. Reported per cell so the first fully covered cohort
   * (published >= 2026-09-01, day-30 outcome ~2026-10-01) is visible the moment it lands.
   */
  packagingCoverage: PackagingCoverage;
}

export type PackagingCoverage = 'full' | 'none';
/** First day the thumbnail/title watcher had captured a baseline for every tracked video. */
export const PACKAGING_COVERAGE_START = '2026-09-01';

export type PackagingType = 'thumbnail_change' | 'ab_rotation' | 'title_change';
export interface PackagingChange { type: PackagingType | string; age: number }

/** Strata every cell is reported in. `pooled` is all rows; the other two partition them. */
export type Stratum = 'pooled' | 'no_change' | 'changed';
export const STRATA: Stratum[] = ['pooled', 'no_change', 'changed'];

/**
 * Did a packaging change land between the age-t observation and the day-30 truth? Those changes
 * are events the model cannot foresee, so a cell's `no_change` subset is the model's own error
 * and the gap to `pooled` is how much of the day-t error is unforecastable.
 */
export function changedAfter(r: BenchRow): boolean {
  return r.packaging.some((c) => c.age > r.day && c.age <= r.truthDay);
}

export function inStratum(r: BenchRow, s: Stratum): boolean {
  return s === 'pooled' ? true : s === 'changed' ? changedAfter(r) : !changedAfter(r);
}

export const stratumRows = (rows: BenchRow[], s: Stratum): BenchRow[] => rows.filter((r) => inStratum(r, s));

export const OUTLIER_THRESHOLD = 2;

export function median(xs: number[]): number | null {
  const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Rows usable for point error: positive estimate and positive truth. */
export function usable(rows: BenchRow[]): BenchRow[] {
  return rows.filter((r) => Number.isFinite(r.est30) && r.est30 > 0 && Number.isFinite(r.actual30) && r.actual30 > 0);
}

export const logErrors = (rows: BenchRow[]): number[] => usable(rows).map((r) => Math.log(r.est30 / r.actual30));

export function medALE(rows: BenchRow[]): number | null {
  return median(logErrors(rows).map(Math.abs));
}

/** Median log ratio. Positive = the model over-forecasts, negative = it under-forecasts. */
export function bias(rows: BenchRow[]): number | null {
  return median(logErrors(rows));
}

export interface OutlierStats { n: number; tp: number; fp: number; fn: number; tn: number; precision: number | null; recall: number | null; f1: number | null; baseRate: number | null }

/** Rows that can carry an outlier call: a positive walk-forward baseline on both sides. */
export function outlierRows(rows: BenchRow[]): BenchRow[] {
  return usable(rows).filter((r) => r.baseline != null && r.baseline > 0 && r.score != null && Number.isFinite(r.score));
}

export function outlierStats(rows: BenchRow[], threshold = OUTLIER_THRESHOLD): OutlierStats {
  const rs = outlierRows(rows);
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const r of rs) {
    const yp = r.score! >= threshold;
    const yt = r.actual30 / r.baseline! >= threshold;
    if (yp && yt) tp++; else if (yp) fp++; else if (yt) fn++; else tn++;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const f1 = precision != null && recall != null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
  return { n: rs.length, tp, fp, fn, tn, precision, recall, f1, baseRate: rs.length ? (tp + fn) / rs.length : null };
}

/** Spearman rank correlation. Ties get average ranks. Null with fewer than 3 pairs or no variance. */
export function spearman(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const rank = (v: number[]): number[] => {
    const idx = v.map((x, i) => [x, i] as [number, number]).sort((a, b) => a[0] - b[0]);
    const r = new Array(v.length).fill(0);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs), ry = rank(ys);
  const n = xs.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n, my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = rx[i] - mx, b = ry[i] - my; num += a * b; dx += a * a; dy += b * b; }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

export interface WithinChannel { channels: number; medianRho: number | null; meanRho: number | null }

/** Median per-channel Spearman of score vs truth ratio, over channels with >= minPerChannel rows. */
export function withinChannelSpearman(rows: BenchRow[], minPerChannel = 5): WithinChannel {
  const by = new Map<string, BenchRow[]>();
  for (const r of outlierRows(rows)) {
    if (!by.has(r.channelId)) by.set(r.channelId, []);
    by.get(r.channelId)!.push(r);
  }
  const rhos: number[] = [];
  for (const rs of by.values()) {
    if (rs.length < minPerChannel) continue;
    const rho = spearman(rs.map((r) => r.score!), rs.map((r) => r.actual30 / r.baseline!));
    if (rho != null) rhos.push(rho);
  }
  return {
    channels: rhos.length,
    medianRho: median(rhos),
    meanRho: rhos.length ? rhos.reduce((a, b) => a + b, 0) / rhos.length : null,
  };
}

export interface ConfidenceCell { n: number; calls: number; hits: number; hitRate: number | null; baseRate: number | null }

/**
 * Confidence-word calibration: among rows the model labelled `early` / `likely` / `confirmed`,
 * how often a >= 2x call was right. A word that promises more certainty should hit more often.
 */
export function confidenceCalibration(rows: BenchRow[], threshold = OUTLIER_THRESHOLD): Record<string, ConfidenceCell> {
  const out: Record<string, ConfidenceCell> = {};
  for (const r of outlierRows(rows)) {
    const c = (out[r.confidence] ??= { n: 0, calls: 0, hits: 0, hitRate: null, baseRate: null });
    c.n++;
    const yt = r.actual30 / r.baseline! >= threshold;
    if (r.score! >= threshold) { c.calls++; if (yt) c.hits++; }
  }
  for (const c of Object.values(out)) {
    c.hitRate = c.calls ? c.hits / c.calls : null;
  }
  // base rate needs a second pass (truth count regardless of the call)
  const truthBy: Record<string, { n: number; t: number }> = {};
  for (const r of outlierRows(rows)) {
    const b = (truthBy[r.confidence] ??= { n: 0, t: 0 });
    b.n++;
    if (r.actual30 / r.baseline! >= threshold) b.t++;
  }
  for (const [k, b] of Object.entries(truthBy)) out[k].baseRate = b.n ? b.t / b.n : null;
  return out;
}

export interface StabilityCell { pairs: number; medianChurn: number | null; sameReading: number }

/**
 * Score churn between consecutive ages of the same video, restricted to pairs where the truth
 * call did not change. Keyed by the EARLIER age of each pair.
 */
export function stability(rows: BenchRow[], ages: number[], threshold = OUTLIER_THRESHOLD): Record<string, StabilityCell> {
  const byVideo = new Map<string, Map<number, BenchRow>>();
  for (const r of outlierRows(rows)) {
    if (!byVideo.has(r.videoId)) byVideo.set(r.videoId, new Map());
    byVideo.get(r.videoId)!.set(r.t, r);
  }
  const out: Record<string, StabilityCell> = {};
  for (let i = 0; i + 1 < ages.length; i++) {
    const a = ages[i], b = ages[i + 1];
    const churn: number[] = [];
    let sameReading = 0;
    for (const m of byVideo.values()) {
      const ra = m.get(a), rb = m.get(b);
      if (!ra || !rb) continue;
      // Daily snapshots are sparse, so with a +-1 day tolerance the SAME reading often serves
      // two consecutive ages. Those pairs are trivially identical and would report churn 0 for
      // free; counted, not measured.
      if (ra.day === rb.day) { sameReading++; continue; }
      const ta = ra.actual30 / ra.baseline! >= threshold;
      const tb = rb.actual30 / rb.baseline! >= threshold;
      if (ta !== tb) continue;                    // truth moved; churn is legitimate
      // A packaging change between the two readings makes the score SUPPOSED to move.
      if (ra.packaging.some((c) => c.age > ra.day && c.age <= rb.day)) continue;
      churn.push(Math.abs(Math.log(ra.score! / rb.score!)));
    }
    out[`${a}->${b}`] = { pairs: churn.length, medianChurn: median(churn), sameReading };
  }
  return out;
}


// ------------------------------------------------------------- packaging lift ---
//
// For a video whose packaging changed at age c, the counterfactual the video page's "what the
// swap did" claim rests on is: how much more (or less) did it end up with than the day-30
// forecast the production scorer would have made from the record RIGHT BEFORE c?
//
//     lift = actual30 / est30(record up to just before c)
//
// A lift of 1.0 means the swap changed nothing the model had not already priced in. Because the
// packaging history begins 2026-09-01, this table is nearly empty today; it is a fixture for the
// October cohort, not yet evidence.

export interface LiftRow {
  videoId: string;
  type: PackagingType | string;
  changeAge: number;        // days since publish
  forecastBefore: number;   // est30 from the record strictly before the change
  actual30: number;
  lift: number;             // actual30 / forecastBefore
}

export interface LiftSummary { type: string; n: number; p25: number | null; median: number | null; p75: number | null }

export function quantile(xs: number[], p: number): number | null {
  const a = xs.filter((x) => Number.isFinite(x)).sort((u, v) => u - v);
  if (!a.length) return null;
  const i = (a.length - 1) * Math.min(Math.max(p, 0), 1);
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (i - lo);
}

export function liftSummary(rows: LiftRow[]): LiftSummary[] {
  const by = new Map<string, number[]>();
  for (const r of rows) {
    if (!Number.isFinite(r.lift) || !(r.lift > 0)) continue;
    if (!by.has(r.type)) by.set(r.type, []);
    by.get(r.type)!.push(r.lift);
  }
  const all = [...by.values()].flat();
  const out: LiftSummary[] = [...by.entries()].map(([type, xs]) => ({
    type, n: xs.length, p25: quantile(xs, 0.25), median: quantile(xs, 0.5), p75: quantile(xs, 0.75),
  }));
  out.sort((a, b) => a.type.localeCompare(b.type));
  if (all.length) out.push({ type: 'all', n: all.length, p25: quantile(all, 0.25), median: quantile(all, 0.5), p75: quantile(all, 0.75) });
  return out;
}

// ------------------------------------------------------------------ report ---

export interface Cell {
  split: string;
  stratum: Stratum;
  t: number;
  n: number;
  medALE: number | null;
  bias: number | null;
  outlier: OutlierStats;
  withinChannel: WithinChannel;
  confidence: Record<string, ConfidenceCell>;
  medianDay: number | null;
  /** How many of this cell's rows have observable packaging history, and how many do not. */
  coverage: Record<PackagingCoverage, number>;
}

export interface BenchmarkReport {
  modelVersion: string;
  generatedAt: string;
  config: Record<string, unknown>;
  ages: number[];
  cells: Cell[];
  stability: Record<string, Record<string, StabilityCell>>;   // split -> pair -> cell
  packagingLift: LiftSummary[];
  notes: string[];
}

export function cellFor(rows: BenchRow[], split: string, t: number, stratum: Stratum = 'pooled', minPerChannel = 5): Cell {
  const rs = stratumRows(rows.filter((r) => r.split === split && r.t === t), stratum);
  return {
    split, stratum, t,
    n: usable(rs).length,
    medALE: medALE(rs),
    bias: bias(rs),
    outlier: outlierStats(rs),
    withinChannel: withinChannelSpearman(rs, minPerChannel),
    confidence: confidenceCalibration(rs),
    medianDay: median(usable(rs).map((r) => r.day)),
    coverage: {
      full: usable(rs).filter((r) => r.packagingCoverage === 'full').length,
      none: usable(rs).filter((r) => r.packagingCoverage === 'none').length,
    },
  };
}

export function buildReport(
  rows: BenchRow[],
  opts: { modelVersion: string; ages: number[]; splits: string[]; config: Record<string, unknown>; notes?: string[]; minPerChannel?: number; lift?: LiftRow[] }
): BenchmarkReport {
  const cells: Cell[] = [];
  for (const split of opts.splits) for (const st of STRATA) for (const t of opts.ages) cells.push(cellFor(rows, split, t, st, opts.minPerChannel ?? 5));
  const stab: Record<string, Record<string, StabilityCell>> = {};
  for (const split of opts.splits) stab[split] = stability(rows.filter((r) => r.split === split), opts.ages);
  return {
    modelVersion: opts.modelVersion,
    generatedAt: new Date().toISOString(),
    config: opts.config,
    ages: opts.ages,
    cells,
    stability: stab,
    packagingLift: liftSummary(opts.lift ?? []),
    notes: opts.notes ?? [],
  };
}

// ----------------------------------------------------------------- compare ---
//
// Thresholds. The Python harness (harness-v2) answers "is this a real difference?" with a paired
// bootstrap; its 90% CI half-widths on medALE in baseline_v3.csv run from 0.0018 (t=14, n=2831)
// to 0.019 (t=1 channel split, n=491) -- i.e. roughly 3-6% of the cell's own value at every age.
// So a plain threshold of 3% of the reference cell, floored at 0.005 log units (0.5% of views),
// sits at or just above that sampling noise for every cell in the table, and does not let a
// small-n cell at t=1 declare a win the harness would call a tie. F1 gets 0.03 absolute: the
// same table's F1 CIs span +-0.03 to +-0.10, so anything tighter is noise.

export const MEDALE_REL = 0.03;
export const MEDALE_FLOOR = 0.005;
export const F1_ABS = 0.03;

export type Verdict = 'better' | 'worse' | 'wash';

export function medALEThreshold(ref: number | null): number {
  if (ref == null || !Number.isFinite(ref)) return MEDALE_FLOOR;
  return Math.max(MEDALE_FLOOR, Math.abs(ref) * MEDALE_REL);
}

/** Lower is better for medALE. */
export function verdictLower(cand: number | null, ref: number | null, threshold: number): Verdict {
  if (cand == null || ref == null) return 'wash';
  const d = cand - ref;
  if (d <= -threshold) return 'better';
  if (d >= threshold) return 'worse';
  return 'wash';
}

/** Higher is better for F1. */
export function verdictHigher(cand: number | null, ref: number | null, threshold: number): Verdict {
  if (cand == null || ref == null) return 'wash';
  const d = cand - ref;
  if (d >= threshold) return 'better';
  if (d <= -threshold) return 'worse';
  return 'wash';
}

export interface CellDelta {
  split: string; stratum: Stratum; t: number;
  nCand: number; nRef: number;
  medALECand: number | null; medALERef: number | null; dMedALE: number | null; medALEVerdict: Verdict;
  f1Cand: number | null; f1Ref: number | null; dF1: number | null; f1Verdict: Verdict;
  biasCand: number | null; biasRef: number | null;
  verdict: Verdict;
}

export function compareReports(cand: BenchmarkReport, ref: BenchmarkReport): { deltas: CellDelta[]; summary: Record<Verdict, number>; verdict: Verdict } {
  const key = (c: { split: string; stratum?: Stratum; t: number }) => `${c.split}|${c.stratum ?? 'pooled'}|${c.t}`;
  const refBy = new Map(ref.cells.map((c) => [key(c), c]));
  const deltas: CellDelta[] = [];
  for (const c of cand.cells) {
    const r = refBy.get(key(c));
    if (!r) continue;
    const th = medALEThreshold(r.medALE);
    const mv = verdictLower(c.medALE, r.medALE, th);
    const fv = verdictHigher(c.outlier.f1, r.outlier.f1, F1_ABS);
    // A cell is BETTER only if nothing regressed and something improved; WORSE if either did.
    let v: Verdict = 'wash';
    if (mv === 'worse' || fv === 'worse') v = 'worse';
    else if (mv === 'better' || fv === 'better') v = 'better';
    deltas.push({
      split: c.split, stratum: c.stratum, t: c.t, nCand: c.n, nRef: r.n,
      medALECand: c.medALE, medALERef: r.medALE,
      dMedALE: c.medALE != null && r.medALE != null ? c.medALE - r.medALE : null, medALEVerdict: mv,
      f1Cand: c.outlier.f1, f1Ref: r.outlier.f1,
      dF1: c.outlier.f1 != null && r.outlier.f1 != null ? c.outlier.f1 - r.outlier.f1 : null, f1Verdict: fv,
      biasCand: c.bias, biasRef: r.bias,
      verdict: v,
    });
  }
  const summary = { better: 0, worse: 0, wash: 0 } as Record<Verdict, number>;
  for (const d of deltas) summary[d.verdict]++;
  const verdict: Verdict = summary.worse > 0 ? 'worse' : summary.better > 0 ? 'better' : 'wash';
  return { deltas, summary, verdict };
}

// ------------------------------------------------------------------ markdown --

const fmt = (x: number | null | undefined, d = 3) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(d));

export function reportMarkdown(rep: BenchmarkReport): string {
  const L: string[] = [];
  L.push(`# Scoring benchmark — ${rep.modelVersion}`);
  L.push('');
  L.push(`Generated ${rep.generatedAt}`);
  L.push('');
  L.push('```json');
  L.push(JSON.stringify(rep.config, null, 2));
  L.push('```');
  const splits = [...new Set(rep.cells.map((c) => c.split))];
  for (const split of splits) {
    L.push('');
    L.push(`## Split: ${split}`);
    for (const st of STRATA) {
      const cs = rep.cells.filter((x) => x.split === split && x.stratum === st);
      if (!cs.length) continue;
      L.push('');
      L.push(`### ${st}`);
      L.push('');
      L.push('| t | n | cov full/none | med day | medALE | bias | P | R | F1 | base rate | rho (within ch) | ch |');
      L.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
      for (const c of cs) {
        L.push(`| ${c.t} | ${c.n} | ${c.coverage.full}/${c.coverage.none} | ${fmt(c.medianDay, 2)} | ${fmt(c.medALE)} | ${fmt(c.bias)} | ${fmt(c.outlier.precision)} | ${fmt(c.outlier.recall)} | ${fmt(c.outlier.f1)} | ${fmt(c.outlier.baseRate)} | ${fmt(c.withinChannel.medianRho)} | ${c.withinChannel.channels} |`);
      }
    }
    L.push('');
    L.push("Confidence-word calibration, pooled (hit rate of this word's own ≥2x calls):");
    L.push('');
    L.push('| t | word | n | calls | hits | hit rate | base rate |');
    L.push('|---|---|---|---|---|---|---|');
    for (const c of rep.cells.filter((x) => x.split === split && x.stratum === 'pooled')) {
      for (const [w, cell] of Object.entries(c.confidence)) {
        L.push(`| ${c.t} | ${w} | ${cell.n} | ${cell.calls} | ${cell.hits} | ${fmt(cell.hitRate)} | ${fmt(cell.baseRate)} |`);
      }
    }
    L.push('');
    L.push('Stability — median |log(score_t / score_next)| on pairs whose truth call did not change and which no packaging change straddles:');
    L.push('');
    L.push('| pair | pairs | median churn | same-reading pairs (excluded) |');
    L.push('|---|---|---|---|');
    for (const [k, v] of Object.entries(rep.stability[split] ?? {})) {
      L.push(`| ${k} | ${v.pairs} | ${fmt(v.medianChurn)} | ${v.sameReading} |`);
    }
  }
  L.push('');
  L.push('## Packaging-change lift');
  L.push('');
  L.push('`lift = actual30 / est30(record strictly before the change)` — what the swap bought over the forecast already in hand.');
  L.push('');
  L.push('| change type | n | p25 | median | p75 |');
  L.push('|---|---|---|---|---|');
  if (!rep.packagingLift.length) L.push('| _(none)_ | 0 | — | — | — |');
  for (const l of rep.packagingLift) L.push(`| ${l.type} | ${l.n} | ${fmt(l.p25)} | ${fmt(l.median)} | ${fmt(l.p75)} |`);
  if (rep.notes.length) {
    L.push('');
    L.push('## Notes');
    for (const n of rep.notes) L.push(`- ${n}`);
  }
  L.push('');
  return L.join('\n');
}

export function compareMarkdown(cand: BenchmarkReport, ref: BenchmarkReport): string {
  const { deltas, summary, verdict } = compareReports(cand, ref);
  const L: string[] = [];
  L.push(`# ${cand.modelVersion} vs ${ref.modelVersion}`);
  L.push('');
  L.push(`medALE threshold: max(${MEDALE_FLOOR}, ${MEDALE_REL * 100}% of the reference cell). F1 threshold: ${F1_ABS} absolute.`);
  L.push('');
  L.push('Read `no_change` first: the pooled number mixes model error with packaging swaps the model could not foresee.');
  L.push('');
  L.push('| split | stratum | t | n | medALE | ref | Δ | | F1 | ref | Δ | | verdict |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const d of deltas) {
    L.push(`| ${d.split} | ${d.stratum} | ${d.t} | ${d.nCand}/${d.nRef} | ${fmt(d.medALECand)} | ${fmt(d.medALERef)} | ${fmt(d.dMedALE)} | ${d.medALEVerdict} | ${fmt(d.f1Cand)} | ${fmt(d.f1Ref)} | ${fmt(d.dF1)} | ${d.f1Verdict} | **${d.verdict}** |`);
  }
  L.push('');
  L.push(`${summary.better} better / ${summary.wash} wash / ${summary.worse} worse → **${verdict}**`);
  L.push('');
  return L.join('\n');
}
