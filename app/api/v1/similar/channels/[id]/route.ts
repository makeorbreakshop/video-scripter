import { NextResponse } from 'next/server';
import { withApiKey, jsonError, intParam, listParam } from '@/lib/api/v1';
import { channelMatchEvidence, isSemanticUnavailable, semanticUnavailableResponse } from '@/lib/semantic/api';
import {
  CHANNELS_COLLECTION,
  QdrantNotFoundError,
  SemanticQdrant,
  uuid5ForId,
} from '@/lib/semantic/qdrant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHANNEL_ID = /^[\w-]{2,64}$/;

interface ChannelPayload {
  channel_id: string;
  name: string;
  subscriber_count: number | null;
  video_count: number | null;
  top_niches: string[];
  baseline: number | null;
  outlier_rate: number | null;
  lane: 'user' | 'corpus';
}

function channelShape(payload: ChannelPayload, similarity?: number) {
  return {
    id: payload.channel_id,
    name: payload.name,
    subscriber_count: payload.subscriber_count,
    video_count: payload.video_count,
    top_niches: payload.top_niches,
    baseline: payload.baseline,
    outlier_rate: payload.outlier_rate,
    ...(similarity == null ? {} : { similarity }),
    tracked: payload.lane === 'user',
  };
}

export const GET = withApiKey(async (req, _caller, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!CHANNEL_ID.test(id)) return jsonError(400, 'bad_request', 'Malformed channel id.');
  const url = new URL(req.url);
  const limit = intParam(url, 'limit', 20, 50);
  const parseCount = (name: string) => {
    const raw = url.searchParams.get(name);
    return raw == null || /^\d+$/.test(raw) ? (raw == null ? null : Number(raw)) : 'invalid';
  };
  const minSubscribers = parseCount('min_subscribers');
  const maxSubscribers = parseCount('max_subscribers');
  if (minSubscribers === 'invalid' || maxSubscribers === 'invalid') return jsonError(400, 'bad_request', 'Subscriber filters must be non-negative integers.');
  if (minSubscribers != null && maxSubscribers != null && minSubscribers > maxSubscribers) return jsonError(400, 'bad_request', 'min_subscribers cannot exceed max_subscribers.');
  const lane = url.searchParams.get('lane');
  if (lane && !['user', 'corpus'].includes(lane)) return jsonError(400, 'bad_request', 'lane must be user or corpus.');
  const excludeIds = (listParam(url, 'exclude_ids') ?? []).slice(0, 100);
  try {
    const qdrant = new SemanticQdrant();
    const source = await qdrant.point<ChannelPayload>(CHANNELS_COLLECTION, id);
    const must: Array<Record<string, unknown>> = [];
    if (minSubscribers != null || maxSubscribers != null) {
      must.push({ key: 'subscriber_count', range: { ...(minSubscribers == null ? {} : { gte: minSubscribers }), ...(maxSubscribers == null ? {} : { lte: maxSubscribers }) } });
    }
    if (lane) must.push({ key: 'lane', match: { value: lane } });
    const hits = await qdrant.query<ChannelPayload>(CHANNELS_COLLECTION, source.vector, {
      limit,
      filter: { ...(must.length ? { must } : {}), must_not: [{ has_id: [uuid5ForId(id), ...excludeIds.map(uuid5ForId)] }] },
    });
    return NextResponse.json({
      requested_mode: 'semantic', effective_mode: 'semantic', degraded: false,
      filters: { min_subscribers: minSubscribers, max_subscribers: maxSubscribers, lane, exclude_ids: excludeIds },
      coverage: { embedded_since: new Date(Date.now() - 30 * 86_400_000).toISOString(), collection: CHANNELS_COLLECTION, version: 'v1', model: 'text-embedding-3-small', dimensions: 512 },
      channel: channelShape(source.payload),
      similar: hits.map((hit, index) => ({
        ...channelShape(hit.payload, hit.score),
        rank: index + 1,
        source: 'semantic',
        match_evidence: channelMatchEvidence(source.payload.top_niches.join(' '), hit.payload.top_niches),
      })),
    });
  } catch (error) {
    if (error instanceof QdrantNotFoundError) return jsonError(404, 'not_found', 'Channel is not embedded.');
    if (isSemanticUnavailable(error)) return semanticUnavailableResponse();
    throw error;
  }
});
