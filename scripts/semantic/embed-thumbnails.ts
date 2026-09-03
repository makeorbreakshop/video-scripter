import { spawn } from 'child_process';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import {
  THUMBNAIL_COLLECTION,
  THUMBNAIL_DIMS,
  THUMBNAIL_IMAGE_MAX_EDGE,
  THUMBNAIL_MODEL,
  THUMBNAIL_MODEL_REVISION,
  THUMBNAIL_PREPROCESSING,
  mapThumbnailPayload,
  selectThumbnailCohort,
  thumbnailCollectionConfig,
  validateThumbnailEmbeddingOutput,
  type ThumbnailCandidate,
  type ThumbnailEmbeddingOutput,
} from '../../lib/semantic/thumbnails';
import { SemanticQdrant, VIDEOS_COLLECTION, uuid5ForId } from '../../lib/semantic/qdrant';
import { READ_BATCH_SIZE, argValue, chunks, db, intArg, runMain } from './common';

interface VideoPayload {
  video_id?: string;
  channel_id?: string;
  channel_name?: string;
  title?: string;
  published_at?: number;
  topic_domain?: string | null;
  topic_niche?: string | null;
  topic_micro?: string | null;
  format_type?: string | null;
  score?: number | null;
  confidence?: string | null;
  is_outlier?: boolean;
}

interface ThumbnailPoint {
  id: string;
  vector: { visual: number[]; visual_title: number[] };
  payload: ReturnType<typeof mapThumbnailPayload>;
}

const ROOT = process.cwd();
const COHORT_PATH = path.join(ROOT, 'docs/prd/semantic-thumbnail-cohort.json');
const RESULTS_PATH = path.join(ROOT, 'docs/prd/semantic-thumbnail-results.json');
const OUTPUT_PATH = path.join(ROOT, 'tmp/semantic-thumbnails-output.json');
const IMAGE_CACHE = path.join(ROOT, 'tmp/semantic-thumbnail-images');
const MODEL_CACHE = path.join(ROOT, 'tmp/semantic-thumbnails-models');
const DEFAULT_PYTHON = path.join(ROOT, 'tmp/semantic-thumbnails-venv/bin/python');

function numeric(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function allVideoPayloads(qdrant: SemanticQdrant): Promise<VideoPayload[]> {
  const payloads: VideoPayload[] = [];
  let offset: string | number | undefined;
  do {
    const page = await qdrant.scroll<VideoPayload>(VIDEOS_COLLECTION, { limit: 1_000, offset });
    payloads.push(...page.points.map((point) => point.payload));
    offset = page.nextPageOffset;
  } while (offset != null);
  return payloads;
}

async function thumbnailUrls(ids: string[]): Promise<Map<string, string>> {
  const output = new Map<string, string>();
  for (const batch of chunks(ids, READ_BATCH_SIZE)) {
    const result = await db().query<{ id: string; thumbnail_url: string | null }>(
      'select id, thumbnail_url from videos where id = any($1::text[])',
      [batch],
    );
    for (const row of result.rows) if (row.thumbnail_url) output.set(row.id, row.thumbnail_url);
  }
  return output;
}

async function subscriberCounts(channelIds: string[]): Promise<Map<string, number | null>> {
  const output = new Map<string, number | null>();
  for (const batch of chunks(channelIds, READ_BATCH_SIZE)) {
    const result = await db().query<{ channel_id: string; subscriber_count: string | number | null }>(
      'select channel_id, subscriber_count from channel_meta where channel_id = any($1::text[])',
      [batch],
    );
    for (const row of result.rows) output.set(row.channel_id, numeric(row.subscriber_count));
  }
  return output;
}

function candidatesFromPayloads(
  payloads: VideoPayload[],
  urls: Map<string, string>,
  subscribers: Map<string, number | null>,
): ThumbnailCandidate[] {
  const candidates: ThumbnailCandidate[] = [];
  for (const payload of payloads) {
    const videoId = payload.video_id;
    const channelId = payload.channel_id;
    const thumbnailUrl = videoId ? urls.get(videoId) : undefined;
    if (!videoId || !channelId || !thumbnailUrl || !payload.title || !Number.isFinite(payload.published_at)) continue;
    candidates.push({
      videoId,
      channelId,
      channelName: payload.channel_name ?? '',
      title: payload.title,
      thumbnailUrl,
      publishedAt: payload.published_at as number,
      topicDomain: payload.topic_domain ?? null,
      topicNiche: payload.topic_niche ?? null,
      topicMicro: payload.topic_micro ?? null,
      formatType: payload.format_type ?? null,
      score: numeric(payload.score),
      confidence: payload.confidence ?? null,
      isOutlier: payload.is_outlier === true,
      subscriberCount: subscribers.get(channelId) ?? null,
    });
  }
  return candidates;
}

async function runWorker(options: {
  python: string;
  model: string;
  revision: string;
  preprocessing: string;
  maxEdge: number;
  dimensions: number;
  batchSize: number;
  device: string;
  allowCpu: boolean;
}): Promise<ThumbnailEmbeddingOutput> {
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  const args = [
    path.join(ROOT, 'scripts/semantic/embed-thumbnails-local.py'),
    '--manifest', COHORT_PATH,
    '--output', OUTPUT_PATH,
    '--image-cache', IMAGE_CACHE,
    '--model', options.model,
    '--revision', options.revision,
    '--preprocessing', options.preprocessing,
    '--max-edge', String(options.maxEdge),
    '--dimensions', String(options.dimensions),
    '--batch-size', String(options.batchSize),
    '--device', options.device,
    ...(options.allowCpu ? ['--allow-cpu'] : []),
  ];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(options.python, args, {
      cwd: ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        HF_HOME: MODEL_CACHE,
        TOKENIZERS_PARALLELISM: 'false',
      },
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Thumbnail worker exited with ${signal ? `signal ${signal}` : `code ${code}`}`));
    });
  });
  return validateThumbnailEmbeddingOutput(JSON.parse(await readFile(OUTPUT_PATH, 'utf8')), options.dimensions);
}

async function qdrantRequest<T>(pathname: string, init: RequestInit = {}): Promise<{ status: number; body: T | null }> {
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
  const body = response.status === 204 ? null : await response.json() as T;
  return { status: response.status, body };
}

async function recreateCollection(): Promise<void> {
  const existing = await qdrantRequest<{ result?: { config?: { params?: { vectors?: Record<string, { size: number }> } } } }>(
    `/collections/${THUMBNAIL_COLLECTION}`,
  );
  if (existing.status !== 404 && existing.status >= 300) {
    throw new Error(`Unable to inspect thumbnail collection (HTTP ${existing.status})`);
  }
  if (existing.status !== 404) {
    const removed = await qdrantRequest(`/collections/${THUMBNAIL_COLLECTION}`, { method: 'DELETE' });
    if (removed.status >= 300) throw new Error(`Unable to reset thumbnail test collection (HTTP ${removed.status})`);
  }
  const created = await qdrantRequest(`/collections/${THUMBNAIL_COLLECTION}`, {
    method: 'PUT', body: JSON.stringify(thumbnailCollectionConfig()),
  });
  if (created.status >= 300) throw new Error(`Unable to create thumbnail collection (HTTP ${created.status})`);

  const indexes: Array<[string, string]> = [
    ['video_id', 'keyword'], ['linked_video_ids', 'keyword'], ['channel_id', 'keyword'],
    ['published_at', 'integer'], ['topic_niche', 'keyword'], ['format_type', 'keyword'],
    ['is_outlier', 'bool'], ['subscriber_count', 'integer'], ['perceptual_hash', 'keyword'],
    ['processed_content_sha256', 'keyword'],
  ];
  for (const [fieldName, fieldSchema] of indexes) {
    const response = await qdrantRequest(`/collections/${THUMBNAIL_COLLECTION}/index?wait=true`, {
      method: 'PUT', body: JSON.stringify({ field_name: fieldName, field_schema: fieldSchema }),
    });
    if (response.status >= 300) throw new Error(`Unable to index ${fieldName} (HTTP ${response.status})`);
  }
}

async function upsert(points: ThumbnailPoint[]): Promise<void> {
  for (const batch of chunks(points, 100)) {
    const response = await qdrantRequest(`/collections/${THUMBNAIL_COLLECTION}/points?wait=true`, {
      method: 'PUT', body: JSON.stringify({ points: batch }),
    });
    if (response.status >= 300) throw new Error(`Thumbnail upsert failed (HTTP ${response.status})`);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const limit = intArg(argv, '--limit') ?? 500;
  if (limit > 500) throw new Error('--limit cannot exceed the experiment cap of 500');
  const maxPerChannel = intArg(argv, '--max-per-channel') ?? 3;
  const batchSize = intArg(argv, '--batch-size') ?? 1;
  const dryRun = argv.includes('--dry-run');
  const allowCpu = argv.includes('--allow-cpu');
  const model = argValue(argv, '--model') ?? THUMBNAIL_MODEL;
  const revision = argValue(argv, '--revision') ?? THUMBNAIL_MODEL_REVISION;
  const python = argValue(argv, '--python') ?? DEFAULT_PYTHON;
  const device = argValue(argv, '--device') ?? 'auto';
  if (!['auto', 'mps', 'cuda', 'cpu'].includes(device)) throw new Error('--device must be auto, mps, cuda, or cpu');

  const startedAt = new Date();
  const qdrant = new SemanticQdrant({ timeoutMs: 30_000 });
  const payloads = await allVideoPayloads(qdrant);
  const ids = [...new Set(payloads.map((item) => item.video_id).filter((id): id is string => Boolean(id)))];
  const channelIds = [...new Set(payloads.map((item) => item.channel_id).filter((id): id is string => Boolean(id)))];
  const [urls, subscribers] = await Promise.all([thumbnailUrls(ids), subscriberCounts(channelIds)]);
  const eligible = candidatesFromPayloads(payloads, urls, subscribers);
  const cohort = selectThumbnailCohort(eligible, {
    limit,
    maxPerChannel,
    forcedIds: ['MpGDoiSH_PQ'],
  });
  if (cohort.length !== limit) throw new Error(`Only ${cohort.length} eligible thumbnails found for requested ${limit}`);

  const cohortArtifact = {
    generatedAt: startedAt.toISOString(),
    sourceCollection: VIDEOS_COLLECTION,
    selection: { limit, maxPerChannel, seed: 'channelsmith-thumbnail-v1', forcedIds: ['MpGDoiSH_PQ'] },
    sourceCounts: { qdrantPayloads: payloads.length, idsReadFromPostgres: ids.length, eligible: eligible.length },
    candidates: cohort,
  };
  await writeFile(COHORT_PATH, `${JSON.stringify(cohortArtifact, null, 2)}\n`);
  console.log(JSON.stringify({ dryRun, selected: cohort.length, eligible: eligible.length, source: payloads.length }));
  if (dryRun) return;

  const output = await runWorker({
    python,
    model,
    revision,
    preprocessing: THUMBNAIL_PREPROCESSING,
    maxEdge: THUMBNAIL_IMAGE_MAX_EDGE,
    dimensions: THUMBNAIL_DIMS,
    batchSize,
    device,
    allowCpu,
  });
  await recreateCollection();
  const embeddedAt = new Date().toISOString();
  const points: ThumbnailPoint[] = output.rows.map((row) => ({
    id: uuid5ForId(`thumbnail:${row.processedContentSha256}`),
    vector: { visual: row.visual, visual_title: row.visualTitle },
    payload: mapThumbnailPayload(row.candidate, {
      perceptualHash: row.perceptualHash,
      contentSha256: row.contentSha256,
      processedContentSha256: row.processedContentSha256,
      model: output.model,
      modelRevision: output.modelRevision,
      preprocessing: output.preprocessing,
      dimensions: output.dimensions,
      embeddedAt,
      linkedVideoIds: row.linkedVideoIds,
    }),
  }));
  await upsert(points);
  const completedAt = new Date();
  const result = {
    generatedAt: completedAt.toISOString(),
    collection: THUMBNAIL_COLLECTION,
    model: output.model,
    modelRevision: output.modelRevision,
    preprocessing: output.preprocessing,
    dimensions: output.dimensions,
    device: output.device,
    selected: cohort.length,
    downloaded: output.downloads,
    uniqueProcessedImages: output.rows.length,
    uniquePerceptualHashes: output.uniquePerceptualHashes,
    exactDuplicatesCollapsed: output.downloads - output.rows.length,
    perceptualHashCollisions: output.rows.length - output.uniquePerceptualHashes,
    failures: output.failures,
    upserted: points.length,
    durationSeconds: (completedAt.getTime() - startedAt.getTime()) / 1_000,
  };
  await writeFile(RESULTS_PATH, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
}

runMain(main);
