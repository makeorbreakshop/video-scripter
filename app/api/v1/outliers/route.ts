// GET /api/v1/outliers?since=&min_score=&limit=&channels= — videos beating their channel baseline,
// across the whole library by default, or restricted to a channel list. Confirmed or likely only.
import { NextResponse } from 'next/server';
import { q } from '@/lib/admin/db';
import { withApiKey, jsonError, intParam, listParam, scoreShape } from '@/lib/api/v1';
import { embedQuery } from '@/lib/semantic/embed';
import { channelMatchEvidence, diversifyByChannel, isSemanticUnavailable, semanticUnavailableResponse } from '@/lib/semantic/api';
import { SemanticQdrant, VIDEOS_COLLECTION } from '@/lib/semantic/qdrant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface OutlierPayload { video_id: string; channel_id: string; topic_niche: string | null }

export const GET = withApiKey(async (req) => {
  const url = new URL(req.url);
  const since = url.searchParams.get('since') || new Date(Date.now() - 90 * 86_400_000).toISOString();
  if (!/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(since)) return jsonError(400, 'bad_request', 'since must be an ISO date.');
  const minScore = Math.max(1, parseFloat(url.searchParams.get('min_score') || '2') || 2);
  const limit = intParam(url, 'limit', 50, 200);
  const channels = listParam(url, 'channels');
  const topic = (url.searchParams.get('topic') || '').trim();
  const maxPerChannelRaw = url.searchParams.get('max_per_channel');
  const maxPerChannel = maxPerChannelRaw == null ? 1 : /^\d+$/.test(maxPerChannelRaw) ? Math.min(Number(maxPerChannelRaw), 20) : null;
  if (maxPerChannel == null) return jsonError(400, 'bad_request', 'max_per_channel must be a non-negative integer.');
  if (!topic && maxPerChannelRaw != null) return jsonError(400, 'bad_request', 'max_per_channel requires topic.');
  const minBaseline = Math.max(0, parseFloat(url.searchParams.get('min_baseline') || '5000') || 5000); // trailers and news wires with tiny baselines are noise
  if (topic) {
    try {
      const vector = await embedQuery(topic);
      const hits = await new SemanticQdrant().query<OutlierPayload>(VIDEOS_COLLECTION, vector, {
        limit: Math.min(limit * (maxPerChannel === 0 ? 5 : 10), 1_000),
        filter: {
          must: [
            { key: 'is_outlier', match: { value: true } },
            { key: 'published_at', range: { gte: Math.floor(new Date(since).getTime() / 1000) } },
            { key: 'score', range: { gte: minScore } },
            ...(channels ? [{ key: 'channel_id', match: { any: channels } }] : []),
          ],
        },
      });
      const ids = hits.map((hit) => hit.payload.video_id);
      const rows = ids.length ? await q<any>(
        `select v.id, v.title, v.channel_id, v.channel_name, v.published_at, v.view_count, v.thumbnail_url,
                s.model_version, s.scored_at, s.snapshot_day, s.views as score_views, s.est30, s.baseline,
                s.n_baseline, s.score, s.same_age_ratio, s.n_same_age, s.confidence
           from videos v join video_scores s on s.video_id = v.id
          where v.id = any($1::text[]) and s.n_baseline >= 5 and s.baseline >= $2`,
        [ids, minBaseline],
      ) : [];
      const byId = new Map(rows.map((row) => [row.id, row]));
      const similarityById = new Map(hits.map((hit) => [hit.payload.video_id, hit.score]));
      const candidates = ids.flatMap((id) => {
          const v = byId.get(id);
          if (!v) return [];
          return [{
            channel_id: v.channel_id,
            id: v.id, title: v.title, channel: { id: v.channel_id, name: v.channel_name },
            published_at: v.published_at, view_count: v.view_count, thumbnail_url: v.thumbnail_url,
            score: scoreShape(v), similarity: similarityById.get(id), source: 'semantic' as const,
            match_evidence: {
              semantic_fields: ['title', 'channel_name', 'topic_niche'],
              lexical_fields: [],
              matched_niches: channelMatchEvidence(topic, [hits.find((hit) => hit.payload.video_id === id)?.payload.topic_niche ?? '']).matched_niches,
            },
          }];
        });
      const videos = diversifyByChannel(candidates, maxPerChannel, limit).map(({ channel_id: _channelId, ...video }, index) => ({ ...video, rank: index + 1 }));
      return NextResponse.json({
        requested_mode: 'semantic', effective_mode: 'semantic', degraded: false,
        since, min_score: minScore, min_baseline: minBaseline, topic,
        filters: { since, min_score: minScore, min_baseline: minBaseline, channels, max_per_channel: maxPerChannel },
        coverage: { embedded_since: new Date(Date.now() - 30 * 86_400_000).toISOString(), collection: VIDEOS_COLLECTION, version: 'v1', model: 'text-embedding-3-small', dimensions: 512 },
        videos,
      });
    } catch (error) {
      if (isSemanticUnavailable(error)) return semanticUnavailableResponse();
      throw error;
    }
  }
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
