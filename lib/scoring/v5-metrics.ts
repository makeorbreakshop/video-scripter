// Pure metric helpers for the v5 verification harness. Kept out of scripts/ so they are testable.
import { median } from './core';

/** Median absolute log error: median |log(pred/truth)|. Null on no usable pairs. */
export function medALE(pairs: Array<[number, number]>): number | null {
  return median(pairs.filter(([p, t]) => p > 0 && t > 0).map(([p, t]) => Math.abs(Math.log(p / t))));
}

/** Median signed log error: median log(pred/truth). Positive means the model reads HIGH. */
export function bias(pairs: Array<[number, number]>): number | null {
  return median(pairs.filter(([p, t]) => p > 0 && t > 0).map(([p, t]) => Math.log(p / t)));
}

/** Ranks with ties averaged. */
export function ranks(xs: number[]): number[] {
  const idx = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
  const r = new Array(xs.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && xs[idx[j + 1]] === xs[idx[i]]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k]] = avg;
    i = j + 1;
  }
  return r;
}

/** Spearman rank correlation. Null with fewer than 3 pairs. */
export function spearman(pairs: Array<[number, number]>): number | null {
  const ok = pairs.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (ok.length < 3) return null;
  const ra = ranks(ok.map((p) => p[0])), rb = ranks(ok.map((p) => p[1]));
  const ma = ra.reduce((s, x) => s + x, 0) / ra.length, mb = rb.reduce((s, x) => s + x, 0) / rb.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < ra.length; i++) {
    const x = ra[i] - ma, y = rb[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : null;
}

export interface PRF { precision: number | null; recall: number | null; f1: number | null; tp: number; fp: number; fn: number }

/** Precision / recall / F1 of "is an outlier" at a threshold, pred vs truth ratios. */
export function prf(pairs: Array<[number, number]>, threshold = 2): PRF {
  let tp = 0, fp = 0, fn = 0;
  for (const [p, t] of pairs) {
    const pi = p >= threshold, ti = t >= threshold;
    if (pi && ti) tp++; else if (pi && !ti) fp++; else if (!pi && ti) fn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  const f1 = precision != null && recall != null && precision + recall > 0
    ? (2 * precision * recall) / (precision + recall) : null;
  return { precision, recall, f1, tp, fp, fn };
}

/** Bucket a log-distance into a readable label. */
export function distanceBucket(logDistance: number): string {
  const d = Math.abs(logDistance);
  if (d <= 1e-9) return '0 (measured)';
  if (d <= 0.35) return '<=0.35 (~1 bucket)';
  if (d <= 0.7) return '0.35-0.7';
  if (d <= 1.4) return '0.7-1.4';
  return '>1.4';
}

/** Age bucket labels for the G accuracy table, from an hour to four years. */
export const AGE_BUCKET_EDGES = [1 / 24, 4 / 24, 12 / 24, 1, 2, 3, 7, 14, 30, 60, 180, 365, 1500] as const;
export function ageBucket(age: number): string {
  const e = AGE_BUCKET_EDGES;
  if (age < e[0]) return '<1h';
  for (let i = e.length - 1; i >= 0; i--) if (age >= e[i]) {
    const lo = e[i];
    const label = (x: number) => (x < 1 ? `${Math.round(x * 24)}h` : `${x}d`);
    return i === e.length - 1 ? `>=${label(lo)}` : `${label(lo)}-${label(e[i + 1])}`;
  }
  return '<1h';
}

export function fmt(x: number | null | undefined, d = 3): string {
  return x == null || !Number.isFinite(x) ? '—' : x.toFixed(d);
}
