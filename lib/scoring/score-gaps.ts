// Why a long-form video under 90 days old has no score, in one word per video.
//
// "No score" is two different states with the same look on screen: a video_scores row whose
// score is null (we tried and had nothing to divide by) and no row at all (the scorer never
// reached it). Both leave a page or a card with a blank where a number belongs, and the reader
// cannot tell an absent measurement from an absent baseline. This names the cause so the
// fixable ones can be fixed and the rest can be said out loud.
//
// scripts/score-gaps.ts reads the facts and prints the counts.

/** The whole cause list, most mechanical first. */
export const GAP_BUCKETS = [
  /** Past the hourly scorer's 60-day window, never picked up by the one-shot --final pass. */
  'outside-scoring-window',
  /** No snapshot and no sample: the scorer has nothing of this video's own to read. */
  'no-observations',
  /** Fewer than three prior long-form videos on the channel — no baseline is possible. */
  'no-channel-baseline',
  /** Priors exist, but fewer than three of them yield a day-30 estimate (all too young). */
  'priors-unusable',
  /** Inside the window with everything it needs, and still no row: a run was skipped. */
  'never-scored-in-window',
  /** Everything present and a row exists, but the score is still null. */
  'other',
] as const;
export type GapBucket = (typeof GAP_BUCKETS)[number];

export interface GapFacts {
  ageDays: number;
  hasScoreRow: boolean;
  score: number | null;
  /** video_scores.n_baseline: how many priors produced a day-30 estimate. */
  nBaseline: number;
  /** view_snapshots + view_samples rows for this video. */
  observations: number;
  /** Prior long-form public videos on the channel with a view count. */
  priorLongform: number;
  /** videos.view_count — the lifetime count --final can normalize down the long tail. */
  viewCount: number;
}

/** The scorer's hourly window; past it only the one-shot --final pass writes a row. */
export const HOURLY_WINDOW_DAYS = 60;
/** A baseline needs this many priors with a day-30 estimate (lib/scoring/core scoreVideo). */
export const MIN_PRIORS = 3;

/** The cause, or null when the video is not a gap at all. */
export function gapBucket(f: GapFacts): GapBucket | null {
  if (f.score != null) return null;
  // Order matters: the first thing that is missing is the thing to fix. A 60-90 day video with
  // no row is scoreable from its lifetime count alone, observations or not, so that comes first.
  if (!f.hasScoreRow && f.ageDays > HOURLY_WINDOW_DAYS && f.viewCount > 0) return 'outside-scoring-window';
  if (f.observations === 0) return 'no-observations';
  if (f.priorLongform < MIN_PRIORS) return 'no-channel-baseline';
  if (f.hasScoreRow && f.nBaseline < MIN_PRIORS) return 'priors-unusable';
  if (!f.hasScoreRow) return 'never-scored-in-window';
  return 'other';
}

/** True when a run of an existing job closes the bucket, rather than more time being needed. */
export function isFixable(b: GapBucket): boolean {
  return b === 'outside-scoring-window' || b === 'never-scored-in-window' || b === 'no-observations';
}

/**
 * What the page and the card say instead of a blank. A reader who sees nothing assumes the
 * product is broken; a reader who is told the channel has three videos knows to wait.
 */
export function gapReasonWords(b: GapBucket, channelName: string | null | undefined): string {
  const ch = channelName && channelName.trim() ? channelName.trim() : null;
  switch (b) {
    case 'no-channel-baseline':
      return ch ? `Not enough ${ch} history yet for a baseline` : 'Not enough channel history yet for a baseline';
    case 'priors-unusable':
      return ch
        ? `${ch}'s recent videos are still too young to set a baseline`
        : "The channel's recent videos are still too young to set a baseline";
    case 'no-observations':
      return 'No view measurements yet — the first lands within a day';
    case 'outside-scoring-window':
    case 'never-scored-in-window':
      return 'Not scored yet — the next scoring run picks it up';
    case 'other':
      return 'No score yet for this video';
  }
}
