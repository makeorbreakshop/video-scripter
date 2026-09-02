// GET /api/v1/channels/:id/videos?sort=score|published|views&limit=
import { NextResponse } from 'next/server';
import { q } from '@/lib/admin/db';
import { withApiKey, jsonError, intParam } from '@/lib/api/v1';

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

  const rows = await q<any>(
    `select v.id, v.title, v.published_at, v.view_count, v.thumbnail_url, v.duration, v.is_short,
            s.score, s.est30, s.baseline, s.confidence, s.same_age_ratio
       from videos v
       left join video_scores s on s.video_id = v.id
      where v.channel_id = $1 and v.published_at is not null
      order by ${order}
      limit $2`,
    [id, limit]
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
      score: v.score == null ? null : {
        score: v.score,
        est30: v.est30,
        baseline: v.baseline,
        same_age_ratio: v.same_age_ratio,
        confidence: v.confidence,
      },
    })),
  });
});
