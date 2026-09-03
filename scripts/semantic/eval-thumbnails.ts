import { createHash } from 'crypto';
import { writeFile } from 'fs/promises';
import path from 'path';
import {
  THUMBNAIL_COLLECTION,
  THUMBNAIL_VECTOR_NAMES,
  summarizeThumbnailRetrieval,
  type ThumbnailRetrievalNeighbor,
  type ThumbnailRetrievalPair,
  type ThumbnailVectorName,
} from '../../lib/semantic/thumbnails';
import { intArg, runMain } from './common';

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
  return createHash('sha256').update('channelsmith-thumbnail-eval-v1\0').update(String(point.id)).digest('hex');
}

function chooseSeeds(points: ThumbnailPoint[], count: number): ThumbnailPoint[] {
  const forced = points.find((point) => point.payload.linked_video_ids.includes('MpGDoiSH_PQ'));
  const ordered = [...points].sort((left, right) => stableOrder(left).localeCompare(stableOrder(right)));
  return [
    ...(forced ? [forced] : []),
    ...ordered.filter((point) => point.id !== forced?.id),
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
  if (seedCount > 100 || neighborCount > 20) throw new Error('Evaluation is capped at 100 seeds and 20 neighbors');

  const points = await allPoints();
  if (points.length < 2) throw new Error(`Need at least two points in ${THUMBNAIL_COLLECTION}`);
  const seeds = chooseSeeds(points, Math.min(seedCount, points.length));
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
        neighbors: results.visual.raw.map((point) => ({ id: point.id, score: point.score, ...point.payload })),
      },
      visualTitle: {
        latencyMs: results.visual_title.latencyMs,
        neighbors: results.visual_title.raw.map((point) => ({ id: point.id, score: point.score, ...point.payload })),
      },
    });
  }

  const artifact = {
    generatedAt: new Date().toISOString(),
    collection: THUMBNAIL_COLLECTION,
    pointCount: points.length,
    methodology: {
      seeds: seeds.length,
      neighborsPerRepresentation: neighborCount,
      exactSearch: true,
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
