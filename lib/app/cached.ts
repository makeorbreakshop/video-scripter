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
import { channelBaselineSeries as channelBaselineSeriesUncached, type BaselinePoint } from './channel-analytics';
import { loadVideoPage as loadVideoPageUncached, type VideoPageView } from './video-page';
import { channelSparklines as channelSparklinesUncached, type Sparkline } from './channel-sparklines';
import { loadTypicalPriors } from './typical-curve';
import { channelTag, videoTag } from './cache-tags';

export { channelTag, videoTag };

/**
 * Benchmark escape hatch. scripts/bench-pages.ts measures the cost of the reads themselves, and
 * an unstable_cache hit measures nothing: the second run of a URL would be a memory read. With
 * BENCH=1 every wrapper below calls the uncached function directly — deterministic, and it
 * cannot leak into production because the flag is only ever set by the bench harness.
 */
const BENCH = process.env.BENCH === '1';

export const CHANNEL_TTL = 300;
export const VIDEO_TTL = 120;


export function cachedChannelHeader(channelId: string): Promise<ChannelHeader | null> {
  if (BENCH) return channelHeaderUncached(channelId);
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
  if (BENCH) return channelVideosUncached(channelId, sort, limit, offset, range);
  return unstable_cache(
    () => channelVideosUncached(channelId, sort, limit, offset, range),
    ['channel-videos', channelId, sort, String(limit), String(offset), range],
    { revalidate: CHANNEL_TTL, tags: [channelTag(channelId)] }
  )();
}

export function cachedChannelVideoCount(channelId: string, range: RangeKey): Promise<number> {
  if (BENCH) return channelVideoCountUncached(channelId, range);
  return unstable_cache(
    () => channelVideoCountUncached(channelId, range),
    ['channel-video-count', channelId, range],
    { revalidate: CHANNEL_TTL, tags: [channelTag(channelId)] }
  )();
}

/** The Analytics tab's series. Same shape of read as the grid: channel + range, no user in it. */
export function cachedChannelBaseline(channelId: string, range: RangeKey): Promise<BaselinePoint[]> {
  if (BENCH) return channelBaselineSeriesUncached(channelId, range);
  return unstable_cache(
    () => channelBaselineSeriesUncached(channelId, range),
    ['channel-baseline', channelId, range],
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
  if (BENCH) return loadVideoPageUncached(videoId);
  const tags = channelId ? [videoTag(videoId), channelTag(channelId)] : [videoTag(videoId)];
  return unstable_cache(
    () => loadVideoPageUncached(videoId),
    // v2: the entry's SHAPE changed (packagingEvents / packagingCards). A cached v1 entry has
    // neither, and the page reading `.length` off undefined is a server-side exception served
    // to every reader whose video was already warm. A new shape is a new key.
    ['video-page-v2', videoId],
    { revalidate: VIDEO_TTL, tags }
  )();
}

/**
 * The /app/channels sparkline lane. Not per-user in substance — the series belong to the
 * channels, not to whoever tracks them — so the key is the sorted id list.
 *
 * Deliberately untagged. Tagging the entry with all 500 channels in it meant any one of them
 * being rescored dropped the whole row of lines, and with a list this size something is
 * always being rescored: the entry never survived to be used. The lane is a 90-day trend, so
 * the five-minute TTL is the whole freshness requirement.
 */
export function cachedSparklines(channelIds: string[]): Promise<Record<string, Sparkline>> {
  const ids = Array.from(new Set((channelIds || []).filter(Boolean))).sort();
  if (!ids.length) return Promise.resolve({});
  if (BENCH) return channelSparklinesUncached(ids);
  return unstable_cache(
    () => channelSparklinesUncached(ids),
    ['channel-sparklines', ids.join(',')],
    { revalidate: CHANNEL_TTL }
  )();
}

/**
 * The prior set behind a video's "typical for this channel" line.
 *
 * It is the channel's history, censored at this video's publish time, so it changes only when
 * the CHANNEL changes — a new upload, a rescore — and never when this video gets a reading.
 * Hence the channel tag: one rescore of the channel drops every one of its videos' prior sets
 * together. Keyed by video because the censoring is per video; three reads saved per page view.
 */
export function cachedTypicalPriors(videoId: string, channelId: string) {
  if (BENCH) return loadTypicalPriors(videoId);
  return unstable_cache(
    () => loadTypicalPriors(videoId),
    ['typical-priors', videoId],
    { revalidate: CHANNEL_TTL, tags: [channelTag(channelId)] }
  )();
}
