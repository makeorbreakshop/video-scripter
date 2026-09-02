// GET /api/v1/outliers?since=&min_score=&limit=&channels= — videos beating their channel baseline,
// across the whole library by default, or restricted to a channel list. Confirmed or likely only.
import { NextResponse } from 'next/server';
import { q } from '@/lib/admin/db';
import { withApiKey, jsonError, intParam, listParam, scoreShape } from '@/lib/api/v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiKey(async (req) => {
  const url = new URL(req.url);
  const since = url.searchParams.get('since') || new Date(Date.now() - 90 * 86_400_000).toISOString();
  if (!/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(since)) return jsonError(400, 'bad_request', 'since must be an ISO date.');
  const minScore = Math.max(1, parseFloat(url.searchParams.get('min_score') || '2') || 2);
  const limit = intParam(url, 'limit', 50, 200);
  const channels = listParam(url, 'channels');
  const minBaseline = Math.max(0, parseFloat(url.searchParams.get('min_baseline') || '5000') || 5000); // trailers and news wires with tiny baselines are noise
  const rows = await q<any>(
    `select v.id, v.title, v.channel_id, v.channel_name, v.published_at, v.view_count, v.thumbnail_url,
            s.model_version, s.scored_at, s.snapshot_day, s.views as score_views, s.est30, s.baseline, s.n_baseline,
            s.score, s.same_age_ratio, s.n_same_age, s.confidence
       from video_scores s join videos v on v.id = s.video_id
      where v.published_at >= $1::timestamptz and s.score >= $2 and s.confidence in ('likely','confirmed')
        and s.n_baseline >= 5 and s.baseline >= $${channels ? 5 : 4}
        and coalesce(v.is_short, false) = false
        ${channels ? 'and v.channel_id = any($4::text[])' : ''}
      order by s.score desc
      limit $3`,
    [since, minScore, limit, ...(channels ? [channels] : []), minBaseline]
  );
  return NextResponse.json({
    since, min_score: minScore, min_baseline: minBaseline,
    videos: rows.map((v) => ({
      id: v.id, title: v.title, channel: { id: v.channel_id, name: v.channel_name }, published_at: v.published_at,
      view_count: v.view_count, thumbnail_url: v.thumbnail_url, score: scoreShape(v),
    })),
  });
});
