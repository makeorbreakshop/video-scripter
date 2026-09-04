// The sparkline lane on /app/channels: where each tracked channel's baseline has been going.
//
// Same column the Analytics tab plots (lib/app/channel-analytics.ts): video_scores.baseline,
// the channel's typical day-30 views as of each video's publish date. Read in publish order
// it IS the channel-level line.
//
// ONE set-based query for the whole list — not one per row, and not a LATERAL per channel.
// The date range is what makes it cheap: `channel_id = any(...) and published_at >= …` is a
// single ranged walk of idx_videos_channel_published_longform, so the number of rows read
// tracks how much the list actually published rather than how many channels are in it. The
// LATERAL version read 60 rows per channel and probed video_scores 15k times: 23.6 s for 500
// channels, against 0.8 s warm here. Downsampling and the percent change are pure
// (lib/app/groups-view.ts).
import { q } from '../admin/db';
import { longformSql } from '../scoring/longform';
import { SPARK_MAX_POINTS, downsample, percentChange, type SparkPoint } from './groups-view';

export interface Sparkline {
  points: SparkPoint[];
  pct: number | null;
}

export const SPARK_DAYS = 90;
/**
 * How far back the fallback may reach for a channel that published nothing in the window.
 * Unbounded, it made Postgres walk the whole history of every channel that has no scores at
 * all — the expensive half of a 500-row list, and all of it for nothing.
 */
const FALLBACK_DAYS = 730;

/**
 * A channel with nothing published in the window still gets a line: its most recent points
 * are better than a blank lane, and the percent change says the same thing either way.
 */
export async function channelSparklines(channelIds: string[]): Promise<Record<string, Sparkline>> {
  const ids = Array.from(new Set((channelIds || []).filter(Boolean)));
  if (!ids.length) return {};

  const rows = await q<{ channel_id: string; t: string; baseline: string | number | null }>(
    `select v.channel_id, v.published_at as t, s.baseline
       from videos v
       join video_scores s on s.video_id = v.id
      where v.channel_id = any($1::text[])
        and v.published_at >= now() - ($2 || ' days')::interval
        and ${longformSql('v')}
        and s.baseline is not null and s.baseline > 0`,
    [ids, String(FALLBACK_DAYS)]
  );

  const byChannel = new Map<string, SparkPoint[]>();
  for (const r of rows) {
    const v = Number(r.baseline);
    if (!Number.isFinite(v) || v <= 0) continue;
    const t = new Date(r.t).getTime();
    if (!Number.isFinite(t)) continue;
    let list = byChannel.get(r.channel_id);
    if (!list) byChannel.set(r.channel_id, (list = []));
    list.push({ t, v });
  }

  const cutoff = Date.now() - SPARK_DAYS * 86_400_000;
  const out: Record<string, Sparkline> = {};
  for (const id of ids) {
    const all = (byChannel.get(id) || []).sort((a, b) => a.t - b.t);
    // Prefer the window; fall back to the most recent points for a channel that has been
    // quiet for three months, so the lane still says where its normal sits.
    const inWindow = all.filter((p) => p.t >= cutoff);
    const chosen = inWindow.length >= 2 ? inWindow.slice(-SPARK_MAX_POINTS) : all.slice(-12);
    const points = downsample(chosen);
    out[id] = { points, pct: percentChange(points) };
  }
  return out;
}
