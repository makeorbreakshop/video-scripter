// The sparkline lane on /app/channels: where each tracked channel's baseline has been going.
//
// Same column the Analytics tab plots (lib/app/channel-analytics.ts): video_scores.baseline,
// the channel's typical day-30 views as of each video's publish date. Read in publish order
// it IS the channel-level line.
//
// ONE query for the whole list, not one per row. A LATERAL over the user's channel ids drives
// idx_videos_channel_published_longform per channel and probes video_scores by its primary
// key, so neither table is scanned; the per-channel LIMIT bounds the read whatever the list
// size. Downsampling and the percent change are pure (lib/app/groups-view.ts).
import { q } from '../admin/db';
import { longformSql } from '../scoring/longform';
import { downsample, percentChange, type SparkPoint } from './groups-view';

export interface Sparkline {
  points: SparkPoint[];
  pct: number | null;
}

export const SPARK_DAYS = 90;
/** Read a little more than we draw, so the 90-day window has something to thin. */
const PER_CHANNEL = 60;

/**
 * A channel with nothing published in the window still gets a line: its most recent points
 * are better than a blank lane, and the percent change says the same thing either way.
 */
export async function channelSparklines(channelIds: string[]): Promise<Record<string, Sparkline>> {
  const ids = Array.from(new Set((channelIds || []).filter(Boolean)));
  if (!ids.length) return {};

  const rows = await q<{ channel_id: string; t: string; baseline: string | number | null }>(
    `select c.channel_id, v.published_at as t, s.baseline
       from unnest($1::text[]) as c(channel_id)
       join lateral (
         select v.id, v.published_at, v.channel_id
           from videos v
          where v.channel_id = c.channel_id
            and ${longformSql('v')}
            and v.published_at is not null
          order by v.published_at desc
          limit ${PER_CHANNEL}
       ) v on true
       join video_scores s on s.video_id = v.id
      where s.baseline is not null and s.baseline > 0`,
    [ids]
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
    const chosen = inWindow.length >= 2 ? inWindow : all.slice(-12);
    const points = downsample(chosen);
    out[id] = { points, pct: percentChange(points) };
  }
  return out;
}
