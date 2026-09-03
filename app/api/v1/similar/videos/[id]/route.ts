import { NextResponse } from 'next/server';
import { q } from '@/lib/admin/db';
import { withApiKey, jsonError, intParam, scoreShape } from '@/lib/api/v1';
import { isSemanticUnavailable, semanticUnavailableResponse } from '@/lib/semantic/api';
import {
  QdrantNotFoundError,
  SemanticQdrant,
  uuid5ForId,
  VIDEOS_COLLECTION,
} from '@/lib/semantic/qdrant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VIDEO_ID = /^[\w-]{6,20}$/;
const ISO = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;

interface VideoPayload {
  video_id: string;
  channel_id: string;
  channel_name: string;
  title: string;
  published_at: number;
  view_count: number | null;
  topic_niche: string | null;
}

export const GET = withApiKey(async (req, _caller, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!VIDEO_ID.test(id)) return jsonError(400, 'bad_request', 'Malformed video id.');
  const url = new URL(req.url);
  const limit = intParam(url, 'limit', 20, 50);
  const excludeChannel = url.searchParams.get('exclude_channel') !== 'false';
  const since = url.searchParams.get('since');
  if (since && (!ISO.test(since) || Number.isNaN(new Date(since).getTime()))) {
    return jsonError(400, 'bad_request', 'since must be an ISO date.');
  }

  try {
    const qdrant = new SemanticQdrant();
    const source = await qdrant.point<VideoPayload>(VIDEOS_COLLECTION, id);
    const must: Array<Record<string, unknown>> = [];
    const mustNot: Array<Record<string, unknown>> = [{ has_id: [uuid5ForId(id)] }];
    if (since) must.push({ key: 'published_at', range: { gte: Math.floor(new Date(since).getTime() / 1000) } });
    if (excludeChannel) mustNot.push({ key: 'channel_id', match: { value: source.payload.channel_id } });
    const hits = await qdrant.query<VideoPayload>(VIDEOS_COLLECTION, source.vector, {
      limit,
      filter: { ...(must.length ? { must } : {}), must_not: mustNot },
    });
    const ids = hits.map((hit) => hit.payload.video_id);
    const rows = ids.length ? await q<any>(
      `select v.id, v.title, v.channel_id, v.channel_name, v.published_at, v.view_count,
              s.model_version, s.scored_at, s.snapshot_day, s.views as score_views, s.est30,
              s.baseline, s.n_baseline, s.score, s.same_age_ratio, s.n_same_age, s.confidence
         from videos v left join video_scores s on s.video_id = v.id
        where v.id = any($1::text[])`,
      [ids],
    ) : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    return NextResponse.json({
      requested_mode: 'semantic', effective_mode: 'semantic', degraded: false,
      filters: { exclude_channel: excludeChannel, since },
      coverage: { embedded_since: new Date(Date.now() - 30 * 86_400_000).toISOString(), collection: VIDEOS_COLLECTION, version: 'v1', model: 'text-embedding-3-small', dimensions: 512 },
      video: {
        id: source.payload.video_id,
        title: source.payload.title,
        channel: { id: source.payload.channel_id, name: source.payload.channel_name },
      },
      similar: hits.flatMap((hit, index) => {
        const row = byId.get(hit.payload.video_id);
        if (!row) return [];
        return [{
          id: row.id,
          rank: index + 1,
          title: row.title,
          channel: { id: row.channel_id, name: row.channel_name },
          published_at: row.published_at,
          view_count: row.view_count,
          score: row.score == null ? null : scoreShape(row),
          similarity: hit.score,
          source: 'semantic',
          match_evidence: {
            semantic_fields: ['title', 'channel_name', 'topic_niche'],
            lexical_fields: [],
            matched_niches: source.payload.topic_niche && source.payload.topic_niche === hit.payload.topic_niche ? [source.payload.topic_niche] : [],
          },
        }];
      }),
    });
  } catch (error) {
    if (error instanceof QdrantNotFoundError) return jsonError(404, 'not_found', 'Video is not embedded.');
    if (isSemanticUnavailable(error)) return semanticUnavailableResponse();
    throw error;
  }
});
