// The cache tag names, in their own module so the invalidation helpers (lib/app/revalidate.ts,
// imported transitively by code the pipeline scripts run) never have to pull in next/cache.
export const channelTag = (channelId: string) => `channel:${channelId}`;
export const videoTag = (videoId: string) => `video:${videoId}`;
