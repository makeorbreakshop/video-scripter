// GET /api/v1/search?q=&mode= — lexical, semantic, or RRF channel search.
import { NextResponse } from 'next/server';
import { ChannelSearchFilters, searchTracked } from '@/lib/app/channels';
import { withApiKey, jsonError, intParam, listParam } from '@/lib/api/v1';
import { channelMatchEvidence, isSemanticUnavailable, lexicalMatchEvidence, semanticUnavailableResponse } from '@/lib/semantic/api';
import { embedQuery, normalizeQuery } from '@/lib/semantic/embed';
import { CHANNELS_COLLECTION, QdrantFilter, reciprocalRankFuse, SemanticQdrant, uuid5ForId } from '@/lib/semantic/qdrant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Mode = 'semantic' | 'lexical' | 'hybrid';

interface SemanticChannelPayload {
  channel_id: string;
  name: string;
  subscriber_count: number | null;
  video_count: number | null;
  top_niches: string[];
  baseline: number | null;
  outlier_rate: number | null;
  lane: 'user' | 'corpus';
}

function optionalInteger(url: URL, name: string): number | null | 'invalid' {
  const raw = url.searchParams.get(name);
  if (raw == null) return null;
  if (!/^\d+$/.test(raw)) return 'invalid';
  return Number(raw);
}

function coverage() {
  return {
    embedded_since: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    collection: CHANNELS_COLLECTION,
    version: 'v1',
    model: 'text-embedding-3-small',
    dimensions: 512,
  };
}

function lexicalShape(row: Awaited<ReturnType<typeof searchTracked>>[number], query: string, niche: string | null) {
  return {
    id: row.channel_id,
    name: row.name,
    subscriber_count: row.subscriber_count == null ? null : Number(row.subscriber_count),
    video_count: row.video_count,
    tracked: row.tracked_lane === 'user',
    match_evidence: lexicalMatchEvidence(query, row.name, row.handle, niche ? [niche] : []),
  };
}

async function semanticSearch(query: string, limit: number, filter: QdrantFilter) {
  const vector = await embedQuery(query);
  const hits = await new SemanticQdrant().query<SemanticChannelPayload>(CHANNELS_COLLECTION, vector, { limit, filter });
  return hits.map((hit) => ({
    id: hit.payload.channel_id,
    name: hit.payload.name,
    subscriber_count: hit.payload.subscriber_count,
    video_count: hit.payload.video_count,
    top_niches: hit.payload.top_niches,
    baseline: hit.payload.baseline,
    outlier_rate: hit.payload.outlier_rate,
    tracked: hit.payload.lane === 'user',
    similarity: hit.score,
    match_evidence: channelMatchEvidence(query, hit.payload.top_niches),
  }));
}

export const GET = withApiKey(async (req) => {
  const url = new URL(req.url);
  const query = normalizeQuery(url.searchParams.get('q') || '');
  if (query.length < 2) return jsonError(400, 'bad_request', 'q must be at least 2 characters.');
  const limit = intParam(url, 'limit', 20, 50);
  const requestedMode = (url.searchParams.get('mode') || 'hybrid') as Mode;
  if (!['semantic', 'lexical', 'hybrid'].includes(requestedMode)) {
    return jsonError(400, 'bad_request', 'mode must be semantic, lexical, or hybrid.');
  }
  const minSubscribers = optionalInteger(url, 'min_subscribers');
  const maxSubscribers = optionalInteger(url, 'max_subscribers');
  if (minSubscribers === 'invalid' || maxSubscribers === 'invalid') {
    return jsonError(400, 'bad_request', 'min_subscribers and max_subscribers must be non-negative integers.');
  }
  if (minSubscribers != null && maxSubscribers != null && minSubscribers > maxSubscribers) {
    return jsonError(400, 'bad_request', 'min_subscribers cannot exceed max_subscribers.');
  }
  const lane = url.searchParams.get('lane') as 'user' | 'corpus' | null;
  if (lane && !['user', 'corpus'].includes(lane)) return jsonError(400, 'bad_request', 'lane must be user or corpus.');
  const niche = (url.searchParams.get('niche') || '').trim() || null;
  const excludeIds = (listParam(url, 'exclude_ids') ?? []).slice(0, 100);
  const normalizedFilters = { min_subscribers: minSubscribers, max_subscribers: maxSubscribers, lane, niche, exclude_ids: excludeIds };
  const lexicalFilters: ChannelSearchFilters = { minSubscribers, maxSubscribers, lane, niche, excludeIds };
  const must: Array<Record<string, unknown>> = [];
  if (minSubscribers != null || maxSubscribers != null) {
    must.push({ key: 'subscriber_count', range: { ...(minSubscribers == null ? {} : { gte: minSubscribers }), ...(maxSubscribers == null ? {} : { lte: maxSubscribers }) } });
  }
  if (lane) must.push({ key: 'lane', match: { value: lane } });
  if (niche) must.push({ key: 'top_niches', match: { value: niche } });
  const semanticFilter: QdrantFilter = {
    ...(must.length ? { must } : {}),
    ...(excludeIds.length ? { must_not: [{ has_id: excludeIds.map(uuid5ForId) }] } : {}),
  };
  const responseBase = { query, requested_mode: requestedMode, filters: normalizedFilters, coverage: coverage() };
  const lexical = async (count: number) => (await searchTracked(query, count, lexicalFilters)).map((row) => lexicalShape(row, query, niche));

  if (requestedMode === 'lexical') {
    const channels = (await lexical(limit)).map((row, index) => ({ ...row, rank: index + 1, source: 'lexical' as const }));
    return NextResponse.json({ ...responseBase, effective_mode: 'lexical', degraded: false, channels });
  }
  try {
    if (requestedMode === 'semantic') {
      const channels = (await semanticSearch(query, limit, semanticFilter)).map((row, index) => ({ ...row, rank: index + 1, source: 'semantic' as const }));
      return NextResponse.json({ ...responseBase, effective_mode: 'semantic', degraded: false, channels });
    }
    const candidateLimit = Math.min(limit * 2, 50);
    const [lexicalRows, semanticRows] = await Promise.all([lexical(candidateLimit), semanticSearch(query, candidateLimit, semanticFilter)]);
    const lexicalById = new Map(lexicalRows.map((row) => [row.id, row]));
    const semanticById = new Map(semanticRows.map((row) => [row.id, row]));
    const ranks = reciprocalRankFuse(
      lexicalRows.map((row) => ({ id: row.id })),
      semanticRows.map((row) => ({ id: row.id })),
      (row) => row.id,
    );
    const channels = ranks.slice(0, limit).map((row, index) => {
      const lexicalRow = lexicalById.get(row.id);
      const semanticRow = semanticById.get(row.id);
      return {
        ...semanticRow,
        ...lexicalRow,
        ...(semanticRow?.similarity == null ? {} : { similarity: semanticRow.similarity }),
        rank: index + 1,
        source: row.source,
        match_evidence: {
          semantic_fields: semanticRow?.match_evidence.semantic_fields ?? [],
          lexical_fields: lexicalRow?.match_evidence.lexical_fields ?? [],
          matched_niches: [...new Set([...(semanticRow?.match_evidence.matched_niches ?? []), ...(lexicalRow?.match_evidence.matched_niches ?? [])])].slice(0, 3),
        },
      };
    });
    return NextResponse.json({ ...responseBase, effective_mode: 'hybrid', degraded: false, channels });
  } catch (error) {
    if (!isSemanticUnavailable(error)) throw error;
    if (requestedMode === 'semantic') return semanticUnavailableResponse();
    const channels = (await lexical(limit)).map((row, index) => ({ ...row, rank: index + 1, source: 'lexical' as const }));
    return NextResponse.json({ ...responseBase, effective_mode: 'lexical', degraded: true, channels });
  }
});
