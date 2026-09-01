// Which videos may appear in a Thumbnail Battle matchup, and how to detect
// YouTube's "gray placeholder" thumbnails at serve time.
//
// Two documented blank-thumbnail sources (2026-09-01):
//  - live streams (duration 'P0D'/'PT0S'): hqdefault is a gray or feed frame
//  - deleted/private videos: i.ytimg serves a ~1KB gray placeholder with 200

export interface BattleVideo {
  thumbnail_url: string | null;
  duration?: string | null;
  is_short?: boolean | null;
  is_institutional?: boolean | null;
  temporal_performance_score?: number | null;
}

const LIVE_DURATIONS = new Set(['P0D', 'PT0S']);

export function isBattleEligible(v: BattleVideo): boolean {
  if (!v.thumbnail_url) return false;
  if (v.is_short) return false;
  if (v.is_institutional) return false;
  if (v.duration != null && LIVE_DURATIONS.has(v.duration)) return false;
  const s = v.temporal_performance_score;
  if (s == null || s <= 0.1 || s > 100) return false;
  return true;
}

// YouTube's placeholder for missing thumbnails is a tiny gray JPEG (~1KB).
// A real hqdefault is tens of KB. 404s are placeholders by definition.
export function looksLikePlaceholderThumb(status: number, contentLength: number | null): boolean {
  if (status !== 200) return true;
  if (contentLength != null && contentLength < 2500) return true;
  return false;
}
