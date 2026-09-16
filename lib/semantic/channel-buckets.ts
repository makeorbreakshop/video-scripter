// Relative niche buckets for a channel's neighbor list.
//
// Absolute cosine cutoffs do not transfer across niches: a channel in a dense, well-populated corner
// of the corpus sits at a higher similarity to everything than one in a sparse corner, so a global
// 0.82 "near" line either swallows a whole niche or empties it. Measured rank samples (mean vector,
// channels_identity_v1, 2026-09-14):
//
//   rank            r10    r25    r50    r100   r200   r400   r800
//   Make or Break   .890   .880   .846   .798   .756   .716   .673
//   Mark Rober      .777   .764   .746   .726   .705   .683   .657
//   Veritasium      .803   .775   .755   .718   .691   .662   .628
//
// So the rule is scale-free: measure each channel's own spread from a robust top down to a fixed deep
// rank (400 — far enough to be outside anyone's niche, shallow enough to still be same-corpus), and
// cut that spread at fixed fractions. "Robust top" is the rank-10 score, not rank 1: a single
// near-duplicate neighbor is common and skews the spread badly (live data: Mark Rober's rank-1 is
// .920 against a rank-10 of .777, which alone would push his near set down to the minimum floor).
//
//   top          = score_at_rank_10
//   spread       = top - score_at_rank_400
//   near_min     = top - 0.40 * spread
//   adjacent_min = top - 0.95 * spread
//
// What that produces on the three channels above:
//   MoBS       spread .890→.716 = .174   near_min ≈ .820 (rank ~70)   adjacent_min ≈ .725 (rank ~390)
//   Mark Rober spread .777→.683 = .094   near_min ≈ .739 (rank ~60)   adjacent_min ≈ .688 (rank ~350)
//   Veritasium spread .803→.662 = .141   near_min ≈ .747 (rank ~60)   adjacent_min ≈ .669 (rank ~360)
//
// MoBS lands on the eyeballed boundaries (near ends ~0.82 around rank 70, where 3D-printing and CNC
// channels start; adjacent ends ~0.72), and the two science channels get non-empty near sets of
// comparable size instead of the empty sets a global 0.82 would have given them.
//
// A knee/gap rule was the alternative; it was rejected because the score curve is smooth — the
// largest gap in these lists sits at rank 1-2, not at the niche boundary, so it is not a stable cut.

export interface RankedNeighbor {
  channel_id: string;
  score: number;
}

export type BucketName = 'near' | 'adjacent' | 'far';

export interface BucketThresholds {
  near_min: number;
  adjacent_min: number;
  /** Rank the robust top was read from. */
  top_rank: number;
  /** Inputs the thresholds were derived from, so a UI can explain the cut. */
  top: number;
  anchor: number;
  anchor_rank: number;
}

export interface BucketOptions {
  /** Rank used as the robust top of the spread, so one near-duplicate neighbor cannot skew it. */
  topRank?: number;
  /** Deep rank that anchors the bottom of the spread (clamped to the list length). */
  anchorRank?: number;
  nearFraction?: number;
  adjacentFraction?: number;
  /** Floor so a short or unusually flat list still yields a usable near set. */
  minNear?: number;
}

export interface BucketResult<T extends RankedNeighbor> {
  thresholds: BucketThresholds;
  near: T[];
  adjacent: T[];
  far: T[];
}

export const DEFAULT_BUCKET_OPTIONS: Required<BucketOptions> = {
  topRank: 10,
  anchorRank: 400,
  nearFraction: 0.40,
  adjacentFraction: 0.95,
  minNear: 10,
};

/**
 * Split a ranked neighbor list (descending score, self already removed) into near / adjacent / far
 * using thresholds derived from this channel's own score spread.
 */
export function channelBuckets<T extends RankedNeighbor>(
  neighbors: T[],
  options: BucketOptions = {},
): BucketResult<T> {
  const { topRank, anchorRank, nearFraction, adjacentFraction, minNear } = { ...DEFAULT_BUCKET_OPTIONS, ...options };
  if (!neighbors.length) {
    return {
      thresholds: { near_min: 0, adjacent_min: 0, top_rank: 0, top: 0, anchor: 0, anchor_rank: 0 },
      near: [], adjacent: [], far: [],
    };
  }
  const sorted = [...neighbors].sort((a, b) => b.score - a.score);
  // Never let the "robust top" fall past the upper half of a short list.
  const topIndex = Math.min(topRank, Math.max(1, Math.floor(sorted.length / 2))) - 1;
  const top = sorted[topIndex].score;
  const anchorIndex = Math.min(anchorRank, sorted.length) - 1;
  const anchor = sorted[anchorIndex].score;
  const spread = Math.max(top - anchor, 0);
  let nearMin = top - nearFraction * spread;
  const adjacentMin = top - adjacentFraction * spread;

  // Flat or very short lists: guarantee at least `minNear` entries rather than one.
  const floorIndex = Math.min(minNear, sorted.length) - 1;
  if (sorted[floorIndex].score < nearMin) nearMin = sorted[floorIndex].score;

  const near = sorted.filter((n) => n.score >= nearMin);
  const adjacent = sorted.filter((n) => n.score < nearMin && n.score >= adjacentMin);
  const far = sorted.filter((n) => n.score < adjacentMin);
  return {
    thresholds: {
      near_min: nearMin, adjacent_min: adjacentMin,
      top, top_rank: topIndex + 1, anchor, anchor_rank: anchorIndex + 1,
    },
    near, adjacent, far,
  };
}
