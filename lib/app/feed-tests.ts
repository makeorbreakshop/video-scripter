// Feed events -> one TestRow per video.
//
// The feed is a log of state changes, but the thing a creator reads is the experiment: an
// A → B → A rotation on one video is one test, not three events. lib/app/packaging.ts decides
// what the thumbnail history *is*, lib/app/test-row.ts turns that into words, and this module
// is the join between the two and a page of feed events. Pure; the reads live in
// lib/app/packaging-rows.ts.
import type { FeedEventLike } from './feed-format';
import { buildTestRow, type TestRowModel, type ThumbRowWithUrl } from './test-row';

/** The event types that mean the thumbnail moved. A title change is not one of these. */
export const PACKAGING_TYPES = ['thumbnail_change', 'ab_rotation'];

/** The videos on this page whose thumbnails moved — the only ones worth reading versions for. */
export function packagingVideoIds(events: FeedEventLike[]): string[] {
  const ids = new Set<string>();
  for (const e of events || []) {
    if (e.video_id && PACKAGING_TYPES.includes(e.type)) ids.add(e.video_id);
  }
  return [...ids];
}

/**
 * One row per video, keyed by video id. A video whose history does not read as a test or a
 * swap (a single image) is simply absent, and the feed falls back to its ordinary card.
 */
export function testRowsForEvents(
  events: FeedEventLike[],
  thumbRows: Record<string, ThumbRowWithUrl[]>,
  now: string | number | Date = Date.now(),
): Record<string, TestRowModel> {
  const facts = new Map<string, FeedEventLike>();
  for (const e of events || []) {
    if (!e.video_id || !PACKAGING_TYPES.includes(e.type)) continue;
    // Keep the newest event for a video: its joined title, score and channel are the current ones.
    const seen = facts.get(e.video_id);
    if (!seen || e.at > seen.at) facts.set(e.video_id, e);
  }
  const out: Record<string, TestRowModel> = {};
  for (const [videoId, e] of facts) {
    const thumbs = thumbRows[videoId];
    if (!thumbs || thumbs.length < 2) continue;
    const row = buildTestRow({
      videoId,
      title: e.video_title || 'Untitled video',
      channelId: e.channel_id,
      channelName: e.channel_name,
      publishedAt: e.published_at,
      views: e.view_count ?? null,
      score: e.score ?? null,
      thumbs,
    }, now);
    if (row) out[videoId] = row;
  }
  return out;
}
