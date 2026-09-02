// Reads for the user-facing channel page: one header row and one page of the video grid.
//
// Direct Postgres only (lib/admin/db.ts) — never supabase-js (2026-08-31 org-wide egress
// incident). Both queries are indexed and bounded: the header aggregates a single channel,
// and the grid is a keyed ORDER BY … LIMIT with the per-video packaging facts pulled in
// lateral subqueries so the planner keeps them to the page's own rows.
import { q, one } from '../admin/db';
import { versionThumbUrl } from './video-page';

export type ChannelHeader = {
  channelId: string;
  name: string;
  avatarUrl: string | null;
  subscriberCount: number | null;
  trackedSince: string | null;
  videoCount: number;
  baseline: number | null;
  scoredCount: number;
  overCount: number;      // videos scoring >= 2x
  overShare: number | null;
};

export type SortKey = 'score' | 'published' | 'views';
export const SORTS: Record<SortKey, string> = {
  // NULLS LAST everywhere: an unscored video is not a zero-scoring video.
  score: 's.score desc nulls last, v.published_at desc nulls last',
  published: 'v.published_at desc nulls last',
  views: 'v.view_count desc nulls last',
};
export const GRID_PAGE = 60;

export type RangeKey = 'all' | '30d' | '90d' | '1y';
const RANGE_INTERVAL: Record<RangeKey, string | null> = { all: null, '30d': '30 days', '90d': '90 days', '1y': '1 year' };
export function parseRange(value: string | string[] | null | undefined): RangeKey {
  const v = Array.isArray(value) ? value[0] : value;
  return v === '30d' || v === '90d' || v === '1y' ? v : 'all';
}
function rangeClause(range: RangeKey): string {
  const iv = RANGE_INTERVAL[range];
  return iv ? ` and v.published_at >= now() - interval '${iv}'` : '';
}
/** How many of the channel's videos fall in the range (for "showing N of M"). */
export async function channelVideoCount(channelId: string, range: RangeKey): Promise<number> {
  const rows = await q<{ n: number }>(`select count(*)::int as n from videos v where v.channel_id = $1${rangeClause(range)}`, [channelId]);
  return rows[0]?.n ?? 0;
}

/**
 * Newest-first is the default. Score used to be, which reads as "videos missing" on a
 * channel we have not scored yet: every row ties at NULL, so the order looks arbitrary and
 * the tail of the catalogue sits behind "Load more" for no visible reason.
 */
export function parseSort(value: string | string[] | null | undefined): SortKey {
  const v = Array.isArray(value) ? value[0] : value;
  return v === 'score' || v === 'views' ? v : 'published';
}

export type GridVideo = {
  id: string;
  title: string;
  published_at: string;
  view_count: number;
  score: number | null;
  confidence: string | null;
  swaps: number;
  last_change: string | null;
  thumb_latest: number | null;
  thumb_prev: number | null;
  title_latest: string | null;
  title_prev: string | null;
  thumbUrl: string;
  prevThumbUrl: string | null;
};

export async function channelHeader(channelId: string): Promise<ChannelHeader | null> {
  const row = await one<any>(
    `select v.channel_id,
            coalesce(max(cm.title), max(v.channel_name)) as name,
            max(cm.avatar_url) as avatar_url,
            max(cm.subscriber_count) as subscriber_count,
            min(v.import_date) as tracked_since,
            count(*)::int as video_count,
            (select percentile_cont(0.5) within group (order by s.baseline)
               from video_scores s where s.channel_id = $1 and s.baseline is not null) as baseline,
            (select count(*)::int from video_scores s
              where s.channel_id = $1 and s.score is not null and s.confidence <> 'insufficient') as scored_count,
            (select count(*)::int from video_scores s
              where s.channel_id = $1 and s.score >= 2 and s.confidence <> 'insufficient') as over_count
       from videos v
       left join channel_meta cm on cm.channel_id = v.channel_id
      where v.channel_id = $1
      group by v.channel_id`,
    [channelId]
  );
  if (!row) return null;
  const scored = Number(row.scored_count ?? 0);
  const over = Number(row.over_count ?? 0);
  return {
    channelId: row.channel_id,
    name: row.name,
    avatarUrl: row.avatar_url ?? null,
    subscriberCount: row.subscriber_count != null ? Number(row.subscriber_count) : null,
    trackedSince: row.tracked_since ? new Date(row.tracked_since).toISOString() : null,
    videoCount: Number(row.video_count ?? 0),
    baseline: row.baseline != null ? Number(row.baseline) : null,
    scoredCount: scored,
    overCount: over,
    overShare: scored > 0 ? over / scored : null,
  };
}

/** Is this channel in the signed-in user's tracked list? */
export async function isTracked(userId: string, channelId: string): Promise<boolean> {
  const row = await one<{ ok: number }>(
    `select 1 as ok from user_channels where user_id = $1 and channel_id = $2 limit 1`,
    [userId, channelId]
  );
  return !!row;
}

/**
 * One page of the grid. Fetches one row past the page so the caller knows whether a
 * "load more" is worth showing without a second COUNT over the whole channel.
 */
export async function channelVideos(
  channelId: string,
  sort: SortKey = 'score',
  limit = GRID_PAGE,
  offset = 0,
  range: RangeKey = 'all'
): Promise<{ videos: GridVideo[]; hasMore: boolean }> {
  const rows = await q<any>(
    `select v.id, v.title, v.published_at, v.view_count, v.thumbnail_url,
            s.score, s.confidence,
            tv.n_versions as thumb_versions, tv.latest as thumb_latest, tv.last_change as thumb_change,
            tt.n_versions as title_versions, tt.last_change as title_change,
            tt.latest_title, tt.prev_title
       from videos v
       left join video_scores s on s.video_id = v.id
       left join lateral (
         select max(version)::int as latest, count(*)::int as n_versions,
                max(first_seen) filter (where version > 1) as last_change
           from thumbnail_versions t where t.video_id = v.id
       ) tv on true
       left join lateral (
         select count(*)::int as n_versions,
                max(first_seen) filter (where version > 1) as last_change,
                (array_agg(title order by version desc))[1] as latest_title,
                (array_agg(title order by version desc))[2] as prev_title
           from title_versions t where t.video_id = v.id
       ) tt on true
      where v.channel_id = $1${rangeClause(range)}
      order by ${SORTS[sort]}
      limit $2 offset $3`,
    [channelId, limit + 1, offset]
  );

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);

  return {
    hasMore,
    videos: page.map((r) => {
      const thumbSwaps = Math.max(0, Number(r.thumb_versions ?? 0) - 1);
      const titleSwaps = Math.max(0, Number(r.title_versions ?? 0) - 1);
      const latest = r.thumb_latest != null ? Number(r.thumb_latest) : null;
      const prev = latest != null && latest > 1 && thumbSwaps > 0 ? latest - 1 : null;
      const changes = [r.thumb_change, r.title_change].filter(Boolean).map((x: any) => new Date(x).getTime());
      return {
        id: r.id,
        title: r.title,
        published_at: new Date(r.published_at).toISOString(),
        view_count: Number(r.view_count ?? 0),
        score: r.score != null && r.confidence !== 'insufficient' ? Number(r.score) : null,
        confidence: r.confidence ?? null,
        swaps: thumbSwaps + titleSwaps,
        last_change: changes.length ? new Date(Math.max(...changes)).toISOString() : null,
        thumb_latest: latest,
        thumb_prev: prev,
        title_latest: titleSwaps > 0 ? r.latest_title ?? null : null,
        title_prev: titleSwaps > 0 ? r.prev_title ?? null : null,
        // No archived version yet: the CDN url we imported is the current thumbnail.
        thumbUrl: latest != null ? versionThumbUrl(r.id, latest) : (r.thumbnail_url || versionThumbUrl(r.id, 1)),
        prevThumbUrl: prev != null ? versionThumbUrl(r.id, prev) : null,
      };
    }),
  };
}
