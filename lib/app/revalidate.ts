// Dropping the tagged caches in lib/app/cached.ts.
//
// revalidateTag only exists inside the Next runtime (a route handler, a server action or a
// server component render), so the standalone pipeline scripts cannot call this directly —
// they POST to /api/app/revalidate instead (lib/app/revalidate-remote.ts). Both calls are
// best effort: a failed invalidation means data up to the TTL stale, never a failed write.
import { channelTag, videoTag } from './cache-tags';

/**
 * next/cache is required lazily: lib/app/channels.ts is also imported by the pipeline
 * scripts, which run outside Next, and a top-level import there would fail at load. Missing
 * runtime or missing request store both mean "no cache to drop" — log and carry on.
 */
function dropTags(tags: string[], where: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { revalidateTag } = require('next/cache') as { revalidateTag: (t: string) => void };
    for (const t of tags) revalidateTag(t);
  } catch (e: any) {
    // No next/cache at all means this is a script or a unit test, not a broken invalidation.
    const msg = String(e?.message ?? e);
    if (!msg.includes('Cannot find module')) console.error(`${where}:`, msg);
  }
}

export function revalidateChannel(channelId: string): void {
  if (!channelId) return;
  dropTags([channelTag(channelId)], 'revalidateChannel');
}

export function revalidateVideo(videoId: string, channelId?: string | null): void {
  if (!videoId) return;
  dropTags(channelId ? [videoTag(videoId), channelTag(channelId)] : [videoTag(videoId)], 'revalidateVideo');
}
