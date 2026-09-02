// GET /api/v1/channels/:id/videos?sort=score|published|views&limit=&since=&until=  (since/until: ISO dates on published_at)
import { NextResponse } from 'next/server';
import { q } from '@/lib/admin/db';
import { withApiKey, jsonError, intParam, scoreShape } from '@/lib/api/v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHANNEL_ID = /^[\w-]{2,64}$/;
const MAX_LIMIT = 200;

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
  const since = url.searchParams.get('since'); const until = url.searchParams.get('until');
  const ISO = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;
  if ((since && !ISO.test(since)) || (until && !ISO.test(until))) return jsonError(400, 'bad_request', 'since/until must be ISO dates.');

  const rows = await q<any>(
    `select v.id, v.title, v.published_at, v.view_count, v.thumbnail_url, v.duration, v.is_short,
            s.model_version, s.scored_at, s.snapshot_day, s.views as score_views, s.est30, s.baseline, s.n_baseline,
            s.score, s.same_age_ratio, s.n_same_age, s.confidence,
            (select count(*)::int from thumbnail_versions t where t.video_id = v.id and t.version > 1) as thumbnail_changes,
            (select count(*)::int from title_versions t where t.video_id = v.id and t.version > 1) as title_changes,
            greatest((select max(first_seen) from thumbnail_versions t where t.video_id = v.id and t.version > 1),
                     (select max(first_seen) from title_versions t where t.video_id = v.id and t.version > 1)) as last_packaging_change
       from videos v
       left join video_scores s on s.video_id = v.id
      where v.channel_id = $1 and v.published_at is not null and coalesce(v.is_short, false) = false
        ${since ? 'and v.published_at >= $3::timestamptz' : ''} ${until ? `and v.published_at <= $${since ? 4 : 3}::timestamptz` : ''}
      order by ${order}
      limit $2`,
    [id, limit, ...(since ? [since] : []), ...(until ? [until] : [])]
  );

  return NextResponse.json({
    channel_id: id,
    sort,
    videos: rows.map((v) => ({
      id: v.id,
      title: v.title,
      published_at: v.published_at,
      view_count: v.view_count,
      thumbnail_url: v.thumbnail_url,
      duration: v.duration,
      is_short: v.is_short ?? false,
      packaging: { thumbnail_changes: v.thumbnail_changes, title_changes: v.title_changes, last_change: v.last_packaging_change },
      score: v.score == null ? null : scoreShape(v),
    })),
  });
});
