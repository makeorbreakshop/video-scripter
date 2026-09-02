// The feed's event vocabulary. Split out of query.ts so client components can import it
// without dragging pg (and therefore node:fs) into the browser bundle.
export type FeedEventType = 'upload' | 'thumbnail_change' | 'ab_rotation' | 'title_change' | 'outlier';

/** Types the feed knows about; anything else is dropped rather than passed to the query. */
export const FEED_TYPES: string[] = ['upload', 'thumbnail_change', 'ab_rotation', 'title_change', 'outlier'];
