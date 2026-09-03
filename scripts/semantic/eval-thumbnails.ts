import { createHash } from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import {
  THUMBNAIL_COLLECTION,
  THUMBNAIL_VECTOR_NAMES,
  summarizeThumbnailRetrieval,
  thumbnailRankingHash,
  type ThumbnailRetrievalNeighbor,
  type ThumbnailRetrievalPair,
  type ThumbnailVectorName,
} from '../../lib/semantic/thumbnails';
import { argValue, intArg, runMain } from './common';

interface ThumbnailPayload {
  video_id: string;
  linked_video_ids: string[];
  channel_id: string;
  channel_name: string;
  title: string;
  thumbnail_url: string;
  perceptual_hash: string;
  embedding_model: string;
  embedding_model_revision: string;
  embedding_preprocessing: string;
  processed_content_sha256: string;
  embedding_dimensions: number;
}

interface ThumbnailPoint {
  id: string | number;
  score?: number;
  vector: { visual: number[]; visual_title: number[] };
  payload: ThumbnailPayload;
}

const OUTPUT_PATH = path.join(process.cwd(), 'docs/prd/semantic-thumbnail-retrieval-pool.json');

async function request<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  const baseUrl = (process.env.QDRANT_URL ?? '').replace(/\/$/, '');
  if (!baseUrl) throw new Error('QDRANT_URL is not set');
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(process.env.QDRANT_API_KEY ? { 'api-key': process.env.QDRANT_API_KEY } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Qdrant returned HTTP ${response.status} for ${pathname}`);
  return await response.json() as T;
}

async function allPoints(): Promise<ThumbnailPoint[]> {
  const points: ThumbnailPoint[] = [];
  let offset: string | number | undefined;
  do {
    const response = await request<{
      result: { points: ThumbnailPoint[]; next_page_offset?: string | number };
    }>(`/collections/${THUMBNAIL_COLLECTION}/points/scroll`, {
      method: 'POST',
      body: JSON.stringify({
        limit: 256,
        ...(offset == null ? {} : { offset }),
        with_payload: true,
        with_vector: true,
      }),
    });
    points.push(...response.result.points);
    offset = response.result.next_page_offset;
  } while (offset != null);
  return points;
}

function stableOrder(point: ThumbnailPoint): string {
  return createHash('sha256')
    .update('channelsmith-thumbnail-eval-v1\0')
    .update(point.payload.video_id)
    .digest('hex');
}

function chooseSeeds(points: ThumbnailPoint[], count: number, requestedIds: string[] = []): ThumbnailPoint[] {
  const byVideoId = new Map<string, ThumbnailPoint>();
  for (const point of points) {
    byVideoId.set(point.payload.video_id, point);
    for (const videoId of point.payload.linked_video_ids) byVideoId.set(videoId, point);
  }
  const requested = requestedIds.map((videoId) => {
    const point = byVideoId.get(videoId);
    if (!point) throw new Error(`Requested evaluation seed is missing: ${videoId}`);
    return point;
  });
  const requestedPointIds = new Set(requested.map((point) => point.id));
  const forced = points.find((point) => point.payload.linked_video_ids.includes('MpGDoiSH_PQ'));
  const ordered = [...points].sort((left, right) => stableOrder(left).localeCompare(stableOrder(right)));
  return [
    ...requested,
    ...(!requested.length && forced ? [forced] : []),
    ...ordered.filter((point) => !requestedPointIds.has(point.id) && (requested.length || point.id !== forced?.id)),
  ].slice(0, count);
}

async function nearest(
  seed: ThumbnailPoint,
  vectorName: ThumbnailVectorName,
  count: number,
): Promise<{ latencyMs: number; neighbors: ThumbnailRetrievalNeighbor[]; raw: ThumbnailPoint[] }> {
  const started = performance.now();
  const response = await request<{ result: { points: ThumbnailPoint[] } }>(
    `/collections/${THUMBNAIL_COLLECTION}/points/query`,
    {
      method: 'POST',
      body: JSON.stringify({
        query: seed.vector[vectorName],
        using: vectorName,
        limit: count + 1,
        with_payload: true,
        with_vector: false,
        params: { exact: true },
      }),
    },
  );
  const latencyMs = performance.now() - started;
  const raw = response.result.points.filter((point) => point.id !== seed.id).slice(0, count);
  return {
    latencyMs,
    raw,
    neighbors: raw.map((point) => ({
      id: point.payload.video_id,
      channelId: point.payload.channel_id,
      title: point.payload.title,
      score: point.score ?? 0,
    })),
  };
}

function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)];
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const seedCount = intArg(argv, '--seeds') ?? 20;
  const neighborCount = intArg(argv, '--neighbors') ?? 5;
  const seedFile = argValue(argv, '--seed-file');
  if (seedCount > 100 || neighborCount > 20) throw new Error('Evaluation is capped at 100 seeds and 20 neighbors');

  const points = await allPoints();
  if (points.length < 2) throw new Error(`Need at least two points in ${THUMBNAIL_COLLECTION}`);
  const buildSignatures = new Set(points.map((point) => [
    point.payload.embedding_model,
    point.payload.embedding_model_revision,
    point.payload.embedding_preprocessing,
    point.payload.embedding_dimensions,
  ].join('|')));
  if (buildSignatures.size !== 1) throw new Error('Thumbnail collection contains mixed embedding builds');
  if (new Set(points.map((point) => point.payload.processed_content_sha256)).size !== points.length) {
    throw new Error('Thumbnail collection contains duplicate processed-image identities');
  }
  const seedArtifact = seedFile
    ? JSON.parse(await readFile(path.resolve(seedFile), 'utf8')) as {
      rankingHash?: string;
      rows?: Array<{ videoId?: string }>;
    }
    : null;
  const requestedSeeds = seedArtifact?.rows
    ?.map((row) => row.videoId)
    .filter((videoId): videoId is string => Boolean(videoId)) ?? [];
  const seeds = chooseSeeds(points, Math.min(seedCount, points.length), requestedSeeds);
  const pairs: ThumbnailRetrievalPair[] = [];
  const latencies: number[] = [];
  const queries = [];
  for (const seed of seeds) {
    const results = {} as Record<ThumbnailVectorName, Awaited<ReturnType<typeof nearest>>>;
    for (const vectorName of THUMBNAIL_VECTOR_NAMES) {
      results[vectorName] = await nearest(seed, vectorName, neighborCount);
      latencies.push(results[vectorName].latencyMs);
    }
    pairs.push({
      seedChannelId: seed.payload.channel_id,
      seedTitle: seed.payload.title,
      visual: results.visual.neighbors,
      visualTitle: results.visual_title.neighbors,
    });
    queries.push({
      seed: { id: seed.id, ...seed.payload },
      visual: {
        latencyMs: results.visual.latencyMs,
        neighbors: results.visual.raw.map((point) => ({ id: point.id, ...point.payload, similarity: point.score })),
      },
      visualTitle: {
        latencyMs: results.visual_title.latencyMs,
        neighbors: results.visual_title.raw.map((point) => ({ id: point.id, ...point.payload, similarity: point.score })),
      },
    });
  }

  const rankingHash = thumbnailRankingHash(queries.map((query) => ({
    seedVideoId: query.seed.video_id,
    visualIds: query.visual.neighbors.map((neighbor) => neighbor.video_id),
    visualTitleIds: query.visualTitle.neighbors.map((neighbor) => neighbor.video_id),
  })));
  if (seedArtifact?.rankingHash && rankingHash !== seedArtifact.rankingHash) {
    throw new Error(
      `Frozen thumbnail ranking changed: expected ${seedArtifact.rankingHash}, received ${rankingHash}`,
    );
  }

  const artifact = {
    generatedAt: new Date().toISOString(),
    collection: THUMBNAIL_COLLECTION,
    pointCount: points.length,
    methodology: {
      seeds: seeds.length,
      seedSource: seedFile ?? 'deterministic video-id hash with forced test video',
      seedVideoIds: seeds.map((seed) => seed.payload.video_id),
      neighborsPerRepresentation: neighborCount,
      exactSearch: true,
      rankingHash,
      expectedRankingHash: seedArtifact?.rankingHash ?? null,
      rankingIntegrity: seedArtifact?.rankingHash ? 'verified' : 'not-frozen',
      labels: 'unjudged pool; diagnostics below are not relevance metrics',
    },
    diagnostics: summarizeThumbnailRetrieval(pairs),
    latencyMs: {
      queries: latencies.length,
      p50: Number(percentile(latencies, 0.5).toFixed(2)),
      p95: Number(percentile(latencies, 0.95).toFixed(2)),
      max: Number(Math.max(...latencies).toFixed(2)),
    },
    queries,
  };
  await writeFile(OUTPUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify({
    pointCount: points.length,
    diagnostics: artifact.diagnostics,
    latencyMs: artifact.latencyMs,
    output: OUTPUT_PATH,
  }));
}

runMain(main);
