// The video page's `?raw=1` toggle: the archived readings, from R2, for a video whose Postgres
// rows have been thinned.
//
// The default chart path never comes here. Past the dense window Postgres holds one reading per
// hour (per day past 30), which draws the same line at the zoom the page renders — the archive
// is for the reader who wants to see every fetch behind that line. It is off by default because
// it is a network read of an object store, not a database index scan.
//
// Cached for an hour: an archived day never changes once written, so the only reason the answer
// moves is a newer day entering the range.
import { unstable_cache } from 'next/cache';
import { rawReadings, r2Config } from '../readings/archive';
import { READING_RETENTION, ms } from '../readings/retention';
import type { ObservationPoint } from '../scoring/observations';

export const RAW_TTL = 3600;

/** True when this video is old enough for the archive to hold anything Postgres does not. */
export function rawIsAvailable(publishedAt: string | Date, now = Date.now()): boolean {
  return !!r2Config() && ms(publishedAt) < now - READING_RETENTION.denseWindowDays * 86_400_000;
}

/**
 * Archived readings for one video as chart points, oldest first. Bounded to the thinned region:
 * inside the dense window Postgres still has everything, so reading R2 there would only add
 * duplicates for mergeObservations to collapse.
 */
export async function cachedRawReadings(
  videoId: string, publishedAt: string | Date, now = Date.now()
): Promise<ObservationPoint[]> {
  const cfg = r2Config();
  if (!cfg) return [];
  const from = new Date(ms(publishedAt)).toISOString();
  const to = new Date(now - READING_RETENTION.denseWindowDays * 86_400_000).toISOString();
  if (Date.parse(to) <= Date.parse(from)) return [];
  return unstable_cache(
    async () => (await rawReadings(videoId, from, to, ['rss', 'api'], cfg))
      .map((r) => ({ at: r.at, views: Number(r.views ?? 0), timeBasis: r.time_basis ?? undefined })),
    // The day the range ends on is in the key, so a new archived day expires the entry rather
    // than waiting out the TTL behind a stale answer.
    ['raw-readings', videoId, to.slice(0, 10)],
    { revalidate: RAW_TTL }
  )();
}
