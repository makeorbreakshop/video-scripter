// The writes that follow a video row into the database at import time.
//
// A video found by RSS 1-2 days after it went up used to get only a view_snapshots row on the
// day we imported it; the first view_samples row waited for the next tracker tick, up to a day
// later. But the videos.list response that produced the import already carries the view count
// at a known instant, which is exactly what a sample is — so it is written as one. The chart's
// implied past (lib/app/chart-series.ts) covers the launch we could not have seen; this covers
// the part we could.
import { clampCount } from '../nightly/tracking-core';

export interface Write { sql: string; params: any[] }

const count = (v: unknown): number => {
  const n = parseInt(String(v ?? '0'), 10);
  return Number.isFinite(n) ? clampCount(n) : 0;
};

/**
 * The view_samples row for a videos.list item, sampled at `at`. Null when the item has no id.
 * `on conflict do nothing` so a re-import never fights a real tracker sample at the same instant.
 */
export function firstSampleWrite(item: any, at: Date): Write | null {
  if (!item?.id) return null;
  const st = item.statistics || {};
  return {
    sql: `insert into view_samples (video_id, sampled_at, view_count, like_count, comment_count)
          values ($1, $2, $3, $4, $5) on conflict do nothing`,
    params: [item.id, at, count(st.viewCount), count(st.likeCount), count(st.commentCount)],
  };
}

/** The per-video writes that follow the `videos` upsert: the sample, the daily snapshot, the tracking row. */
export function ingestWrites(item: any, tier: number, at: Date): Write[] {
  const out: Write[] = [];
  const sample = firstSampleWrite(item, at);
  if (sample) out.push(sample);
  if (!item?.id) return out;
  const st = item.statistics || {};
  const publishedAt = item.snippet?.publishedAt ?? null;
  out.push({
    sql: `insert into view_snapshots (video_id, snapshot_date, view_count, like_count, comment_count, days_since_published)
          values ($1, current_date, $2, $3, $4, (current_date - $5::date)) on conflict do nothing`,
    params: [item.id, count(st.viewCount), count(st.likeCount), count(st.commentCount), publishedAt],
  });
  out.push({
    sql: `insert into view_tracking_priority (video_id, priority_tier, next_track_date)
          values ($1, $2, current_date + 1) on conflict (video_id) do nothing`,
    params: [item.id, tier],
  });
  return out;
}
