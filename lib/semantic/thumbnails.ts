import { createHash } from 'crypto';

export const THUMBNAIL_MODEL = 'tencent/WeMM-Embedding-4B';
export const THUMBNAIL_MODEL_REVISION = 'a28b25c5d18cf71ec46b115e06ea79ab00ee4819';
export const THUMBNAIL_DIMS = 512;
export const THUMBNAIL_IMAGE_MAX_EDGE = 640;
export const THUMBNAIL_PREPROCESSING = 'exif-rgb-fit-640x640-jpeg95';
export const THUMBNAIL_COLLECTION = 'thumbnails_wemm4b_test_v1';
export const THUMBNAIL_VECTOR_NAMES = ['visual', 'visual_title'] as const;

export type ThumbnailVectorName = typeof THUMBNAIL_VECTOR_NAMES[number];
export type ChannelSizeBand = 'under_10k' | '10k_100k' | '100k_1m' | 'over_1m' | 'unknown';

export interface ThumbnailCandidate {
  videoId: string;
  channelId: string;
  channelName: string;
  title: string;
  thumbnailUrl: string;
  publishedAt: number;
  topicDomain: string | null;
  topicNiche: string | null;
  topicMicro: string | null;
  formatType: string | null;
  score: number | null;
  confidence: string | null;
  isOutlier: boolean;
  subscriberCount: number | null;
}

export interface ThumbnailCohortOptions {
  limit?: number;
  maxPerChannel?: number;
  seed?: string;
  forcedIds?: string[];
}

function stableHash(seed: string, value: string): string {
  return createHash('sha256').update(seed).update('\0').update(value).digest('hex');
}

function canonicalCandidate(candidate: ThumbnailCandidate): string {
  return JSON.stringify(Object.entries(candidate).sort(([left], [right]) => left.localeCompare(right)));
}

export function channelSizeBand(subscriberCount: number | null): ChannelSizeBand {
  if (subscriberCount == null || !Number.isFinite(subscriberCount) || subscriberCount < 0) return 'unknown';
  if (subscriberCount < 10_000) return 'under_10k';
  if (subscriberCount < 100_000) return '10k_100k';
  if (subscriberCount < 1_000_000) return '100k_1m';
  return 'over_1m';
}

export function thumbnailStratum(candidate: ThumbnailCandidate): string {
  return [
    candidate.topicDomain || 'unknown-domain',
    candidate.topicNiche || 'unknown-niche',
    candidate.formatType || 'unknown-format',
    candidate.isOutlier ? 'outlier' : 'ordinary',
    channelSizeBand(candidate.subscriberCount),
  ].join('|');
}

function thumbnailFacets(candidate: ThumbnailCandidate): string[] {
  return [
    `domain:${candidate.topicDomain || 'unknown'}`,
    `niche:${candidate.topicNiche || 'unknown'}`,
    `format:${candidate.formatType || 'unknown'}`,
    `outlier:${candidate.isOutlier}`,
    `size:${channelSizeBand(candidate.subscriberCount)}`,
  ];
}

function validThumbnailUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function selectThumbnailCohort(
  input: ThumbnailCandidate[],
  options: ThumbnailCohortOptions = {},
): ThumbnailCandidate[] {
  const limit = options.limit ?? 500;
  const maxPerChannel = options.maxPerChannel ?? 3;
  const seed = options.seed ?? 'channelsmith-thumbnail-v1';
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Thumbnail cohort limit must be a positive integer');
  if (!Number.isInteger(maxPerChannel) || maxPerChannel < 1) {
    throw new Error('Thumbnail cohort maxPerChannel must be a positive integer');
  }

  const byId = new Map<string, ThumbnailCandidate>();
  for (const candidate of input) {
    if (!candidate.videoId || !candidate.channelId || !validThumbnailUrl(candidate.thumbnailUrl)) continue;
    const existing = byId.get(candidate.videoId);
    if (!existing || canonicalCandidate(candidate) < canonicalCandidate(existing)) byId.set(candidate.videoId, candidate);
  }

  const selected: ThumbnailCandidate[] = [];
  const selectedIds = new Set<string>();
  const channelCounts = new Map<string, number>();
  const facetCounts = new Map<string, number>();
  const add = (candidate: ThumbnailCandidate): boolean => {
    if (selectedIds.has(candidate.videoId)) return false;
    const count = channelCounts.get(candidate.channelId) ?? 0;
    if (count >= maxPerChannel) return false;
    selected.push(candidate);
    selectedIds.add(candidate.videoId);
    channelCounts.set(candidate.channelId, count + 1);
    for (const facet of thumbnailFacets(candidate)) facetCounts.set(facet, (facetCounts.get(facet) ?? 0) + 1);
    return true;
  };

  for (const id of options.forcedIds ?? []) {
    const candidate = byId.get(id);
    if (candidate) add(candidate);
    if (selected.length >= limit) return selected;
  }

  const remaining = [...byId.values()].sort((left, right) =>
    stableHash(seed, left.videoId).localeCompare(stableHash(seed, right.videoId)));
  while (selected.length < limit) {
    let best: ThumbnailCandidate | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of remaining) {
      if (selectedIds.has(candidate.videoId)) continue;
      if ((channelCounts.get(candidate.channelId) ?? 0) >= maxPerChannel) continue;
      const score = thumbnailFacets(candidate)
        .reduce((total, facet) => total + (facetCounts.get(facet) ?? 0), 0);
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    if (!best) break;
    add(best);
  }

  return selected;
}

export function thumbnailCollectionConfig(dimensions = THUMBNAIL_DIMS) {
  return {
    vectors: {
      visual: { size: dimensions, distance: 'Cosine' },
      visual_title: { size: dimensions, distance: 'Cosine' },
    },
    on_disk_payload: true,
  } as const;
}

export function thumbnailQueryBody(
  vector: number[],
  using: ThumbnailVectorName,
  limit = 20,
  withVector = false,
) {
  return {
    query: vector,
    using,
    limit,
    with_payload: true,
    with_vector: withVector,
  };
}

export interface ThumbnailPayloadOptions {
  perceptualHash: string;
  contentSha256: string;
  model?: string;
  modelRevision?: string;
  preprocessing?: string;
  dimensions?: number;
  embeddedAt?: string;
  linkedVideoIds?: string[];
}

export interface ThumbnailEmbeddingFailure {
  videoId: string;
  reason: string;
}

export interface ThumbnailEmbeddingRow {
  candidate: ThumbnailCandidate;
  linkedVideoIds: string[];
  perceptualHash: string;
  contentSha256: string;
  visual: number[];
  visualTitle: number[];
}

export interface ThumbnailEmbeddingOutput {
  model: string;
  modelRevision: string;
  preprocessing: string;
  dimensions: number;
  device: string;
  downloads: number;
  failures: ThumbnailEmbeddingFailure[];
  rows: ThumbnailEmbeddingRow[];
}

export interface ThumbnailRetrievalNeighbor {
  id: string;
  channelId: string;
  title: string;
  score: number;
}

export interface ThumbnailRetrievalPair {
  seedChannelId: string;
  seedTitle: string;
  visual: ThumbnailRetrievalNeighbor[];
  visualTitle: ThumbnailRetrievalNeighbor[];
}

function roundMetric(value: number): number {
  return Number(value.toFixed(4));
}

function titleTokens(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length > 1) ?? []);
}

function titleTokenJaccard(left: string, right: string): number {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  const union = new Set([...leftTokens, ...rightTokens]);
  if (!union.size) return 0;
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1;
  return intersection / union.size;
}

export function summarizeThumbnailRetrieval(pairs: ThumbnailRetrievalPair[]) {
  if (!pairs.length) {
    return {
      seeds: 0,
      overlapAtK: 0,
      visual: { crossChannelRate: 0, meanTitleTokenOverlap: 0 },
      visualTitle: { crossChannelRate: 0, meanTitleTokenOverlap: 0 },
    };
  }
  let overlap = 0;
  let overlapDenominator = 0;
  const representation = (name: 'visual' | 'visualTitle') => {
    let neighbors = 0;
    let crossChannel = 0;
    let titleOverlap = 0;
    for (const pair of pairs) {
      for (const neighbor of pair[name]) {
        neighbors += 1;
        if (neighbor.channelId !== pair.seedChannelId) crossChannel += 1;
        titleOverlap += titleTokenJaccard(pair.seedTitle, neighbor.title);
      }
    }
    return {
      crossChannelRate: roundMetric(neighbors ? crossChannel / neighbors : 0),
      meanTitleTokenOverlap: roundMetric(neighbors ? titleOverlap / neighbors : 0),
    };
  };
  for (const pair of pairs) {
    const visualIds = new Set(pair.visual.map((item) => item.id));
    overlap += pair.visualTitle.filter((item) => visualIds.has(item.id)).length;
    overlapDenominator += Math.min(pair.visual.length, pair.visualTitle.length);
  }
  return {
    seeds: pairs.length,
    overlapAtK: roundMetric(overlapDenominator ? overlap / overlapDenominator : 0),
    visual: representation('visual'),
    visualTitle: representation('visualTitle'),
  };
}

function assertVector(value: unknown, name: string, dimensions: number): asserts value is number[] {
  if (!Array.isArray(value) || value.length !== dimensions || value.some((item) => !Number.isFinite(item))) {
    throw new Error(`${name} must contain ${dimensions} finite numbers`);
  }
  const norm = Math.sqrt(value.reduce((sum, item) => sum + item * item, 0));
  if (Math.abs(norm - 1) > 0.02) throw new Error(`${name} must be L2 normalized`);
}

export function validateThumbnailEmbeddingOutput(
  value: unknown,
  expectedDimensions = THUMBNAIL_DIMS,
): ThumbnailEmbeddingOutput {
  if (!value || typeof value !== 'object') throw new Error('Thumbnail worker output must be an object');
  const output = value as Partial<ThumbnailEmbeddingOutput>;
  if (typeof output.model !== 'string' || !output.model) throw new Error('Thumbnail worker model is missing');
  if (typeof output.modelRevision !== 'string' || !/^[0-9a-f]{40}$/i.test(output.modelRevision)) {
    throw new Error('Thumbnail worker model revision is missing or invalid');
  }
  if (typeof output.preprocessing !== 'string' || !output.preprocessing) {
    throw new Error('Thumbnail worker preprocessing is missing');
  }
  if (output.dimensions !== expectedDimensions) {
    throw new Error(`Thumbnail worker dimensions must equal ${expectedDimensions}`);
  }
  if (typeof output.device !== 'string' || !output.device) throw new Error('Thumbnail worker device is missing');
  if (!Number.isInteger(output.downloads) || (output.downloads ?? -1) < 0) {
    throw new Error('Thumbnail worker downloads must be a non-negative integer');
  }
  if (!Array.isArray(output.failures) || !Array.isArray(output.rows)) {
    throw new Error('Thumbnail worker rows and failures must be arrays');
  }

  const hashes = new Set<string>();
  for (const [index, row] of output.rows.entries()) {
    if (!row || typeof row !== 'object') throw new Error(`rows[${index}] must be an object`);
    if (!row.candidate?.videoId) throw new Error(`rows[${index}].candidate is missing`);
    if (!Array.isArray(row.linkedVideoIds) || !row.linkedVideoIds.length) {
      throw new Error(`rows[${index}].linkedVideoIds is missing`);
    }
    if (!/^[0-9a-f]{16}$/i.test(row.perceptualHash)) {
      throw new Error(`rows[${index}].perceptualHash is invalid`);
    }
    if (hashes.has(row.perceptualHash)) throw new Error(`Duplicate perceptual hash ${row.perceptualHash}`);
    hashes.add(row.perceptualHash);
    if (!/^[0-9a-f]{64}$/i.test(row.contentSha256)) {
      throw new Error(`rows[${index}].contentSha256 is invalid`);
    }
    assertVector(row.visual, `rows[${index}].visual`, expectedDimensions);
    assertVector(row.visualTitle, `rows[${index}].visualTitle`, expectedDimensions);
  }
  return output as ThumbnailEmbeddingOutput;
}

export function mapThumbnailPayload(candidate: ThumbnailCandidate, options: ThumbnailPayloadOptions) {
  return {
    video_id: candidate.videoId,
    linked_video_ids: options.linkedVideoIds ?? [candidate.videoId],
    channel_id: candidate.channelId,
    channel_name: candidate.channelName,
    title: candidate.title,
    thumbnail_url: candidate.thumbnailUrl,
    published_at: candidate.publishedAt,
    topic_domain: candidate.topicDomain,
    topic_niche: candidate.topicNiche,
    topic_micro: candidate.topicMicro,
    format_type: candidate.formatType,
    score: candidate.score,
    confidence: candidate.confidence,
    is_outlier: candidate.isOutlier,
    subscriber_count: candidate.subscriberCount,
    channel_size_band: channelSizeBand(candidate.subscriberCount),
    perceptual_hash: options.perceptualHash,
    content_sha256: options.contentSha256,
    embedding_model: options.model ?? THUMBNAIL_MODEL,
    embedding_model_revision: options.modelRevision ?? THUMBNAIL_MODEL_REVISION,
    embedding_preprocessing: options.preprocessing ?? THUMBNAIL_PREPROCESSING,
    embedding_dimensions: options.dimensions ?? THUMBNAIL_DIMS,
    embedded_at: options.embeddedAt ?? new Date().toISOString(),
  };
}
