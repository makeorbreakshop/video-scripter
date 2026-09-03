// Tagged caches for the reads that are identical for every user.
//
// A channel's header, its grid page and its video count depend only on the channel and the
// URL parameters — two users looking at the same channel get byte-identical data — so they
// are worth caching across requests. Anything per-user (listUserChannels, feedFor,
// isTracked) is deliberately NOT here.
//
// unstable_cache (Next 15.5; the 'use cache' directive and PPR are canary-only and need
// config changes) memoises the function's JSON-serialisable return value against the key
// parts. Every argument is in the key. The wrapped functions must not read cookies() or
// headers() — they are plain Postgres reads in lib/app/channel-page.ts — and the pg pool is
// created lazily inside lib/admin/db.ts, never at module init.
//
// Invalidation is by tag: `channel:<id>` and `video:<id>` (lib/app/revalidate.ts).
import { unstable_cache } from 'next/cache';
import {
  channelHeader as channelHeaderUncached,
  channelVideos as channelVideosUncached,
  channelVideoCount as channelVideoCountUncached,
  type ChannelHeader, type GridVideo, type SortKey, type RangeKey, GRID_PAGE,
} from './channel-page';
import { loadVideoPage as loadVideoPageUncached, type VideoPageView } from './video-page';
import { channelTag, videoTag } from './cache-tags';

export { channelTag, videoTag };

export const CHANNEL_TTL = 300;
export const VIDEO_TTL = 120;


export function cachedChannelHeader(channelId: string): Promise<ChannelHeader | null> {
  return unstable_cache(
    () => channelHeaderUncached(channelId),
    ['channel-header', channelId],
    { revalidate: CHANNEL_TTL, tags: [channelTag(channelId)] }
  )();
}

export function cachedChannelVideos(
  channelId: string,
  sort: SortKey = 'score',
  limit = GRID_PAGE,
  offset = 0,
  range: RangeKey = 'all'
): Promise<{ videos: GridVideo[]; hasMore: boolean }> {
  return unstable_cache(
    () => channelVideosUncached(channelId, sort, limit, offset, range),
    ['channel-videos', channelId, sort, String(limit), String(offset), range],
    { revalidate: CHANNEL_TTL, tags: [channelTag(channelId)] }
  )();
}

export function cachedChannelVideoCount(channelId: string, range: RangeKey): Promise<number> {
  return unstable_cache(
    () => channelVideoCountUncached(channelId, range),
    ['channel-video-count', channelId, range],
    { revalidate: CHANNEL_TTL, tags: [channelTag(channelId)] }
  )();
}

/**
 * The whole video page. Nothing in loadVideoPage is per-user — it is the video row, its
 * snapshots/samples, its packaging history and the channel's baseline — so one cache entry
 * serves everybody. `now` is deliberately not a parameter: a cached entry would freeze it
 * anyway, and the 120 s TTL bounds how stale the age/pace numbers can get.
 *
 * Tagged with the channel too, so a channel-wide rescore drops its videos' pages with it.
 * The channel id is only known after the read, hence the two-step: the id-only entry is
 * looked up first and the channel tag added on the second pass.
 */
export function cachedVideoPage(videoId: string, channelId?: string | null): Promise<VideoPageView | null> {
  const tags = channelId ? [videoTag(videoId), channelTag(channelId)] : [videoTag(videoId)];
  return unstable_cache(
    () => loadVideoPageUncached(videoId),
    ['video-page', videoId],
    { revalidate: VIDEO_TTL, tags }
  )();
}
