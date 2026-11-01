// GET /api/v1/channels/:id/videos?sort=score|published|views&limit=&offset=&since=&until=&exclude_live=
//   since/until: ISO dates on published_at. offset: skip that many rows (max 5000) to page past `limit`.
//   exclude_live=1 drops past live streams (videos YouTube reports an actualStartTime for).
import { NextResponse } from 'next/server';
import { q } from '@/lib/admin/db';
import { withApiKey, jsonError, intParam, scoreShape } from '@/lib/api/v1';
import { longformSql } from '@/lib/scoring/longform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHANNEL_ID = /^[\w-]{2,64}$/;
const MAX_LIMIT = 200;
const MAX_OFFSET = 5000;

// A video is a past live stream when YouTube gave it liveStreamingDetails.actualStartTime. The
// broadcast fields live in video_text.metadata (moved there from videos.metadata; either copy may
// hold them, see lib/app/video-text.ts).
const WAS_LIVE_SQL = `(coalesce(vt.metadata, v.metadata)->'live_streaming_details' ? 'actualStartTime')`;

// Whitelist, not interpolation: `sort` reaches SQL as an order-by clause, so it never comes
// from user text. All three orders are covered by idx_videos_channel_published / video_scores.
const ORDERS: Record<string, string> = {
  score: 's.score desc nulls last, v.published_at desc',
  published: 'v.published_at desc',
  views: 'v.view_count desc nulls last',
};

export const GET = withApiKey(async (req, _caller, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!CHANNEL_ID.test(id)) return jsonError(400, 'bad_request', 'Malformed channel id.');

  const url = new URL(req.url);
  const sort = url.searchParams.get('sort') || 'published';
  const order = ORDERS[sort];
  if (!order) return jsonError(400, 'bad_request', `Unknown sort "${sort}". Use score, published or views.`);
  const limit = intParam(url, 'limit', 50, MAX_LIMIT);
  const offset = intParam(url, 'offset', 0, MAX_OFFSET);
  const excludeLive = ['1', 'true'].includes(url.searchParams.get('exclude_live') || '');
  const since = url.searchParams.get('since'); const until = url.searchParams.get('until');
  const ISO = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;
  if ((since && !ISO.test(since)) || (until && !ISO.test(until))) return jsonError(400, 'bad_request', 'since/until must be ISO dates.');

  const rows = await q<any>(
    `select v.id, v.title, v.published_at, v.view_count, v.thumbnail_url, v.duration, v.is_short,
            ${WAS_LIVE_SQL} as was_live,
            s.model_version, s.scored_at, s.snapshot_day, s.views as score_views, s.est30, s.baseline, s.n_baseline,
            s.score, s.same_age_ratio, s.n_same_age, s.confidence,
            (select count(*)::int from thumbnail_versions t where t.video_id = v.id and t.version > 1) as thumbnail_changes,
            (select count(*)::int from title_versions t where t.video_id = v.id and t.version > 1) as title_changes,
            greatest((select max(first_seen) from thumbnail_versions t where t.video_id = v.id and t.version > 1),
                     (select max(first_seen) from title_versions t where t.video_id = v.id and t.version > 1)) as last_packaging_change
       from videos v
       left join video_scores s on s.video_id = v.id
       left join video_text vt on vt.video_id = v.id
      where v.channel_id = $1 and v.published_at is not null and ${longformSql('v')}
        ${excludeLive ? `and not coalesce(${WAS_LIVE_SQL}, false)` : ''}
        ${since ? 'and v.published_at >= $4::timestamptz' : ''} ${until ? `and v.published_at <= $${since ? 5 : 4}::timestamptz` : ''}
      order by ${order}, v.id
      limit $2 offset $3`,
    [id, limit, offset, ...(since ? [since] : []), ...(until ? [until] : [])]
  );

  return NextResponse.json({
    channel_id: id,
    sort,
    offset,
    videos: rows.map((v) => ({
      id: v.id,
      title: v.title,
      published_at: v.published_at,
      view_count: v.view_count,
      thumbnail_url: v.thumbnail_url,
      duration: v.duration,
      is_short: v.is_short ?? false,
      was_live: v.was_live ?? false,
      packaging: { thumbnail_changes: v.thumbnail_changes, title_changes: v.title_changes, last_change: v.last_packaging_change },
      score: v.score == null ? null : scoreShape(v),
    })),
  });
});
