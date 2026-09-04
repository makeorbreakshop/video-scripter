// The feed's event vocabulary. Split out of query.ts so client components can import it
// without dragging pg (and therefore node:fs) into the browser bundle.
export type FeedEventType = 'upload' | 'thumbnail_change' | 'ab_rotation' | 'title_change' | 'outlier';

/** Types the feed knows about; anything else is dropped rather than passed to the query. */
export const FEED_TYPES: string[] = ['upload', 'thumbnail_change', 'ab_rotation', 'title_change', 'outlier'];

/**
 * Types emitted roughly once per video, so a channel's history of them is as long as its
 * catalogue. This matters to how the feed is read: probing 500 channels for their newest 60
 * events of a dense type reads 500 × 60 index entries, while one walk down the global
 * (at desc) index fills the same page within a couple of thousand. Sparse types — the
 * packaging ones, and outliers, which only a fraction of videos ever become — are the other
 * way round. Measured in docs/perf/2026-09-04-feed-speed-audit.md.
 */
export const DENSE_FEED_TYPES: string[] = ['upload'];
