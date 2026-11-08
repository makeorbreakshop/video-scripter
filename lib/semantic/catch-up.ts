/**
 * The channel leg's "changed since" filter re-checks video_scores/channel_meta per window row and is
 * I/O-bound: ~65 s cold for one hour, >150 s for a 12-day gap, against a 45 s statement timeout.
 * After a long gap nearly every channel in the 30-day window has changed anyway, so recover by
 * re-checking the whole window (a plain published_at index scan) instead of failing every hour.
 */
export const CHANNEL_FILTER_MAX_GAP_MS = 6 * 60 * 60_000;

export function channelUpdatedSince(changedSince: Date, now: Date, maxGapMs = CHANNEL_FILTER_MAX_GAP_MS): Date | undefined {
  return now.getTime() - changedSince.getTime() > maxGapMs ? undefined : changedSince;
}
