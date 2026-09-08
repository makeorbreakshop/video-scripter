/**
 * Is this candidate fit allowed to become the champion?
 *
 * Pure: numbers in, verdict out. scripts/weekly-refit.ts collects the numbers by running the
 * three harnesses; everything about how a pass or a failure is DECIDED lives here so it can be
 * tested without a database and read without running anything.
 *
 * The thresholds are the outlier-score skill's change protocol, made mechanical:
 *
 *   benchmark    no cell may regress past max(0.005, 3% of the reference medALE), and no cell
 *                may lose more than 0.03 F1 (lib/scoring/benchmark.ts owns those constants and
 *                the per-cell verdicts; this only decides what a set of cell verdicts means).
 *                Cells are read `no_change` BEFORE `pooled`: packaging coverage starts
 *                2026-09-01, so on the historical corpus `no_change` is the honest stratum and
 *                `pooled` silently contains unseen swaps. When both exist for a cell, the
 *                no_change one names the worst cell.
 *   stability    median churn on unchanged-truth pairs may not rise by more than 0.03.
 *   calibration  the inner ribbon claims 50% of videos and the outer 80%; ±5 points either way.
 *   estimate     backtest-baseline-trend --estimate-coverage medALE, the only gate that sees
 *                v5.3's channelCurve, may not exceed the recorded reference by more than
 *                max(0.005, 3% of it).
 *
 * A gate with no numbers (the harness could not produce a comparable cell) does NOT pass by
 * default: it is `inconclusive`, and an inconclusive gate blocks promotion the same way a
 * failure does. Promoting on absent evidence is how v5.3 shipped ungated in the first place.
 */

export const MEDALE_REL = 0.03;
export const MEDALE_FLOOR = 0.005;
export const F1_ABS = 0.03;
export const STABILITY_ABS = 0.03;
/** Held-out band coverage targets and the tolerance around them, in percentage points. */
export const BAND_INNER_TARGET = 50;
export const BAND_OUTER_TARGET = 80;
export const BAND_TOLERANCE = 5;

/** max(0.005, 3% of the reference) — the skill's margin, and benchmark.ts's. */
export function relThreshold(ref: number | null | undefined): number {
  if (ref == null || !Number.isFinite(ref)) return MEDALE_FLOOR;
  return Math.max(MEDALE_FLOOR, MEDALE_REL * Math.abs(ref));
}

export type GateStatus = 'pass' | 'fail' | 'inconclusive';

export interface GateResult {
  status: GateStatus;
  /** The one number a human should read first. */
  headline: string;
  /** Everything the row stores, for the model_evals `gates` jsonb. */
  detail: Record<string, unknown>;
}

// ------------------------------------------------------------------- benchmark

/** One `--compare` cell, as lib/scoring/benchmark.compareReports emits it. */
export interface CellDeltaInput {
  split: string;
  stratum?: string;
  t: number;
  nCand?: number | null;
  medALECand: number | null;
  medALERef: number | null;
  f1Cand: number | null;
  f1Ref: number | null;
  /** 'better' | 'worse' | 'wash', already computed per cell by benchmark.ts. */
  verdict: string;
}

/**
 * How badly a cell broke its own threshold, in units of that threshold. 0 when it did not.
 *
 * EPS because these are differences of doubles: 0.309 - 0.3 - 0.009 is 9.6e-16, not 0, and a
 * cell sitting exactly ON its threshold must not be called a regression on float dust.
 */
const EPS = 1e-12;
export function cellRegression(c: CellDeltaInput): number {
  let worst = 0;
  if (c.medALECand != null && c.medALERef != null) {
    const th = relThreshold(c.medALERef);
    const over = c.medALECand - c.medALERef - th;
    if (over > EPS) worst = Math.max(worst, over / th);
  }
  if (c.f1Cand != null && c.f1Ref != null) {
    const over = c.f1Ref - c.f1Cand - F1_ABS;
    if (over > EPS) worst = Math.max(worst, over / F1_ABS);
  }
  return worst;
}

export const cellName = (c: CellDeltaInput) => `${c.split}/${c.stratum ?? 'pooled'}/t=${c.t}`;

/**
 * `no_change` before `pooled`: when the same (split, t) appears in both strata, only the
 * no_change one is eligible to be named the worst cell. Both still gate.
 */
function preferNoChange(cells: CellDeltaInput[]): CellDeltaInput[] {
  const hasNoChange = new Set(
    cells.filter((c) => (c.stratum ?? 'pooled') === 'no_change').map((c) => `${c.split}|${c.t}`)
  );
  return cells.filter((c) => {
    const st = c.stratum ?? 'pooled';
    if (st === 'pooled' && hasNoChange.has(`${c.split}|${c.t}`)) return false;
    return true;
  });
}

export function benchmarkGate(cells: CellDeltaInput[] | null | undefined): GateResult {
  if (!cells || !cells.length) {
    return { status: 'inconclusive', headline: 'no comparable cells', detail: { cells: 0 } };
  }
  const regressed = cells.filter((c) => cellRegression(c) > 0 || c.verdict === 'worse');
  const ranked = preferNoChange(regressed).sort((a, b) => cellRegression(b) - cellRegression(a));
  const worst = ranked[0] ?? regressed.sort((a, b) => cellRegression(b) - cellRegression(a))[0] ?? null;
  const counts = { better: 0, worse: 0, wash: 0 } as Record<string, number>;
  for (const c of cells) counts[c.verdict] = (counts[c.verdict] ?? 0) + 1;
  const detail = {
    cells: cells.length, ...counts,
    worstCell: worst ? cellName(worst) : null,
    worstMedALE: worst?.medALECand ?? null,
    refMedALE: worst?.medALERef ?? null,
    worstF1: worst?.f1Cand ?? null,
    refF1: worst?.f1Ref ?? null,
  };
  if (!regressed.length) {
    return { status: 'pass', headline: `${counts.better ?? 0} better / ${counts.wash ?? 0} wash / 0 worse`, detail };
  }
  return {
    status: 'fail',
    headline: `${regressed.length} regressed cell(s); worst ${cellName(worst!)}`,
    detail,
  };
}

// ------------------------------------------------------------------- stability

export interface StabilityInput { split: string; pair: string; candChurn: number | null; refChurn: number | null }

export function stabilityGate(rows: StabilityInput[] | null | undefined): GateResult {
  const usable = (rows ?? []).filter((r) => r.candChurn != null && r.refChurn != null);
  if (!usable.length) {
    return { status: 'inconclusive', headline: 'no comparable stability rows', detail: { rows: 0 } };
  }
  const worst = usable
    .map((r) => ({ r, d: r.candChurn! - r.refChurn! }))
    .sort((a, b) => b.d - a.d)[0];
  const detail = {
    rows: usable.length, worstRow: `${worst.r.split}/${worst.r.pair}`,
    worstDelta: Number(worst.d.toFixed(4)), cand: worst.r.candChurn, ref: worst.r.refChurn,
    threshold: STABILITY_ABS,
  };
  return worst.d > STABILITY_ABS
    ? { status: 'fail', headline: `churn +${worst.d.toFixed(4)} on ${detail.worstRow}`, detail }
    : { status: 'pass', headline: `worst churn delta +${worst.d.toFixed(4)}`, detail };
}

// ----------------------------------------------------------------- calibration

export interface CalibrationInput { inner: number | null; outer: number | null; n: number }

export function calibrationGate(c: CalibrationInput | null | undefined): GateResult {
  if (!c || c.inner == null || c.outer == null || !c.n) {
    return { status: 'inconclusive', headline: 'no band calibration run', detail: { n: c?.n ?? 0 } };
  }
  const dInner = Math.abs(c.inner - BAND_INNER_TARGET);
  const dOuter = Math.abs(c.outer - BAND_OUTER_TARGET);
  const detail = { inner: c.inner, outer: c.outer, n: c.n, tolerance: BAND_TOLERANCE, dInner, dOuter };
  const headline = `inner ${c.inner.toFixed(1)}% / outer ${c.outer.toFixed(1)}% (n=${c.n})`;
  return dInner > BAND_TOLERANCE || dOuter > BAND_TOLERANCE
    ? { status: 'fail', headline, detail }
    : { status: 'pass', headline, detail };
}

// -------------------------------------------------------------- estimate slide

export interface EstimateInput { medALE: number | null; bias: number | null; n: number; refMedALE: number | null }

export function estimateGate(e: EstimateInput | null | undefined): GateResult {
  if (!e || e.medALE == null || !e.n) {
    return { status: 'inconclusive', headline: 'no estimate-coverage run', detail: { n: e?.n ?? 0 } };
  }
  if (e.refMedALE == null) {
    return { status: 'inconclusive', headline: 'no recorded reference medALE', detail: { medALE: e.medALE, n: e.n } };
  }
  const th = relThreshold(e.refMedALE);
  const detail = { medALE: e.medALE, bias: e.bias, n: e.n, ref: e.refMedALE, threshold: th };
  const headline = `medALE ${e.medALE.toFixed(4)} vs ref ${e.refMedALE.toFixed(4)} (±${th.toFixed(4)})`;
  return e.medALE - e.refMedALE > th + 1e-12
    ? { status: 'fail', headline, detail }
    : { status: 'pass', headline, detail };
}

// ------------------------------------------------------------------- the verdict

export type Verdict = 'promoted' | 'rejected';

export interface GateSet {
  benchmark: GateResult;
  stability: GateResult;
  calibration: GateResult;
  estimate: GateResult;
}

export interface RefitVerdict {
  verdict: Verdict;
  /** Which gate to blame, in the order a human would look. Null when everything passed. */
  failed: (keyof GateSet)[];
  worstCell: string | null;
  notes: string;
}

export const GATE_ORDER: (keyof GateSet)[] = ['estimate', 'benchmark', 'stability', 'calibration'];

/** ALL four gates must pass. An inconclusive gate is not a pass. */
export function decide(gates: GateSet): RefitVerdict {
  const failed = GATE_ORDER.filter((k) => gates[k].status !== 'pass');
  const worstCell = (gates.benchmark.detail.worstCell as string | null) ?? null;
  if (!failed.length) {
    return {
      verdict: 'promoted', failed: [], worstCell,
      notes: GATE_ORDER.map((k) => `${k}: ${gates[k].headline}`).join('; '),
    };
  }
  return {
    verdict: 'rejected', failed, worstCell,
    notes: failed.map((k) => `${k} ${gates[k].status}: ${gates[k].headline}`).join('; '),
  };
}
