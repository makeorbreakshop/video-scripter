// Pure math for temporal baselines — the SINGLE source of truth after the
// 2026-09-01 unit unification (see shared-memory 2026-09-01-performance-math-audit).
//
// CONVENTION (the only one, everywhere):
//   channel_baseline_at_publish = median(day30 estimates of eligible prior
//     videos) / GLOBAL_P50_DAY30            -> dimensionless channel ratio
//   temporal_performance_score  = video day30 estimate /
//     (baseline_ratio * GLOBAL_P50_DAY30)   -> "x times own channel baseline"
//
// The score is numerically identical to day30/medianRaw; only the stored
// baseline unit changed (was raw views on one path, ratio on another).

export interface Snapshot {
  view_count: number;
  days_since_published: number;
}

export const SCORE_CAP = 99999.999;

export function median(values: number[]): number {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Day-30 view estimate via the envelope curve-ratio ("shape") method. */
export function day30Estimate(
  currentViews: number,
  ageDays: number,
  snapshots: Snapshot[],
  envelope: Map<number, number>
): number {
  const p50Day30 = envelope.get(30) || 29742;
  if (snapshots.length > 0) {
    let closest: Snapshot | null = null;
    let minDist = Infinity;
    for (const s of snapshots) {
      const d = Math.abs(s.days_since_published - 30);
      if (d < minDist) {
        minDist = d;
        closest = s;
      }
    }
    if (closest) {
      const curveAt = envelope.get(Math.min(Math.max(closest.days_since_published, 0), 365)) || p50Day30;
      return closest.view_count * (p50Day30 / curveAt);
    }
  }
  const curveAtNow = envelope.get(Math.min(Math.max(Math.floor(ageDays), 0), 365)) || p50Day30;
  return currentViews * (p50Day30 / curveAtNow);
}

export interface PriorVideo {
  published_at: string | Date;
  day30_estimate: number;
}

/**
 * Median raw-views baseline for the video at `index` in a channel's
 * chronologically sorted list. Mirrors the documented rules:
 * first video -> own estimate; videos 2-10 -> all priors; 11+ -> last 10
 * videos already mature (>30d old) at this video's publish, else last 10.
 */
export function rawBaselineAt(videos: PriorVideo[], index: number): number {
  if (index === 0) return Math.max(videos[0].day30_estimate, 1);
  const prior = videos.slice(0, index);
  const pubTime = new Date(videos[index].published_at).getTime();
  const mature = prior.filter(
    (p) => (pubTime - new Date(p.published_at).getTime()) / 86400000 > 30
  );
  const pool =
    index <= 10 ? prior : mature.length >= 10 ? mature.slice(-10) : prior.slice(-10);
  return Math.max(median(pool.map((p) => p.day30_estimate)), 1);
}

/** Convert a raw-views baseline to the stored dimensionless ratio. */
export function baselineRatio(rawBaseline: number, envelope: Map<number, number>): number {
  const p50Day30 = envelope.get(30) || 29742;
  return rawBaseline / p50Day30;
}

/** Score under the unified convention (identical numerics to day30/rawBaseline). */
export function temporalScore(
  day30Est: number,
  ratio: number,
  envelope: Map<number, number>
): number {
  const p50Day30 = envelope.get(30) || 29742;
  const denom = Math.max(ratio * p50Day30, 1);
  return Math.min(day30Est / denom, SCORE_CAP);
}

/** Heuristic: does a stored baseline value look like legacy raw views? */
export function looksLikeRawBaseline(value: number): boolean {
  // Ratios cluster in ~0.001..1000 (channel median vs global median).
  // Raw view baselines for any real channel are >= ~100s and commonly >> 1000.
  return value > 5000;
}
