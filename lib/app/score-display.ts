/**
 * How a score is rendered — the one place that decides it, so the channel grid, the feed and
 * the video page cannot drift apart.
 *
 * Three tones, not four. The scale is a multiple of the channel's own baseline, so the printed
 * number ("0.8×", "2.5×") already says which side of normal a video is on; the tone is
 * redundant emphasis on top of that, and its job is to make the one case the product exists
 * for — the outlier — findable in a grid.
 */
export { OUTLIER_AT } from './feed-format';
import { OUTLIER_AT } from './feed-format';

/**
 * Below this, a video is quiet enough to recede. Not 1.0: the day-30 forecast cannot separate
 * 0.99× from 1.01×, and splitting the scale there gave two identical videos opposite
 * treatments. A 20% margin puts the boundary outside that noise.
 */
export const UNDER_AT = 0.8;

export type ScoreTone = 'outlier' | 'normal' | 'under' | 'none';

export function scoreTone(score: number | null | undefined): ScoreTone {
  if (score === null || score === undefined || !Number.isFinite(score)) return 'none';
  if (score >= OUTLIER_AT) return 'outlier';
  if (score < UNDER_AT) return 'under';
  return 'normal';
}
