// The Analytics tab's one read: the channel's baseline over time.
//
// Every video_scores row carries `baseline` — the channel's typical day-30 views AS OF that
// video's publish date (the median day-30 of the videos before it). Read in publish order that
// column IS the channel-level line: where the channel's normal sat, video by video. The same
// row's `est30` is that video's own day-30 estimate, so plotting it as a dot at the same x puts
// each video against the bar it actually had to clear.
//
// Direct Postgres only (lib/admin/db.ts) — never supabase-js (2026-08-31 org-wide egress
// incident). ONE query, always predicated on channel_id: it drives
// idx_videos_channel_published_longform and probes video_scores by its primary key, so
// video_scores is never scanned. video_scores_pkey is UNIQUE on (video_id) — one row per video,
// whatever model_version wrote it — so "the newest row per video" is a plain join, the same one
// the grid does in lib/app/channel-page.ts.
import { q } from '../admin/db';
import { longformSql } from '../scoring/longform';
import type { RangeKey } from './channel-page';
import type { BaselinePoint } from './baseline-series';

export * from './baseline-series';

const RANGE_INTERVAL: Record<RangeKey, string | null> = {
  all: null, '30d': '30 days', '90d': '90 days', '1y': '1 year',
};

/** Bounds the read on a channel with a decade of uploads and range=all. */
const MAX_POINTS = 2000;

export async function channelBaselineSeries(channelId: string, range: RangeKey = '1y'): Promise<BaselinePoint[]> {
  const iv = RANGE_INTERVAL[range];
  const rows = await q<any>(
    `select v.id, v.title, v.published_at, s.baseline, s.est30, s.score, s.confidence
       from videos v
       join video_scores s on s.video_id = v.id
      where v.channel_id = $1
        and ${longformSql('v')}
        and v.published_at is not null
        ${iv ? `and v.published_at >= now() - interval '${iv}'` : ''}
      order by v.published_at desc
      limit ${MAX_POINTS}`,
    [channelId]
  );
  // Newest-first off the index, then flipped: the LIMIT has to keep the RECENT tail, and the
  // chart reads left to right.
  return rows.reverse().map(toPoint);
}

function toPoint(r: any): BaselinePoint {
  const at = new Date(r.published_at);
  const weak = r.confidence === 'insufficient' || r.confidence == null;
  return {
    videoId: r.id,
    title: r.title ?? '',
    t: at.getTime(),
    publishedAt: at.toISOString(),
    baseline: num(r.baseline),
    est30: num(r.est30),
    score: weak ? null : num(r.score),
    weak,
  };
}

function num(v: any): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

