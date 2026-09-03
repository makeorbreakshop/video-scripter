import fs from 'node:fs/promises';
import path from 'node:path';
import { q } from '../admin/db';
import {
  cosineSimilarity,
  extractChannelTitles,
  extractTitleForm,
} from '../semantic/packaging-transfer';
import {
  INSPIRATION_RECIPE,
  inspirationSearchState,
  rankInspirationCandidates,
  type InspirationComponents,
  type InspirationDistance,
} from '../semantic/inspiration';
import {
  QdrantNotFoundError,
  QdrantUnavailableError,
  SemanticQdrant,
  type QdrantRetrievedPoint,
  type QdrantSearchHit,
} from '../semantic/qdrant';
import {
  validateInspirationFeedbackReceipt,
  type InspirationFeedbackInput,
} from './inspiration-feedback-core';

const EVAL_DIR = path.join(process.cwd(), 'docs/prd/semantic-eval-v4');
const CANDIDATE_POOL_SIZE = 1_500;
const RESULT_LIMIT = 24;

interface EvalManifest {
  as_of: string;
  model: string;
  dimensions: number;
  video_collection: string;
  channel_collection: string;
}

interface ProofRow {
  score: number;
  n_baseline: number;
}

interface EvalArtifacts {
  manifest: EvalManifest;
  proof: Array<{ outlier_score: number; n_baseline: number }>;
}

interface ChannelPayload {
  channel_id: string;
  channel_name: string;
  name: string;
  document: string;
}

interface VideoPayload {
  video_id: string;
  channel_id: string;
  channel_name: string;
  title: string;
  thumbnail_url: string | null;
  published_at: number;
  score: number;
  n_baseline: number;
}

export interface InspirationTarget {
  channelId: string;
  name: string;
  avatarUrl: string | null;
  role: 'self' | 'competitor';
}

export interface InspirationResult {
  videoId: string;
  channelId: string;
  channelName: string;
  title: string;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  outlierScore: number;
  baselineVideos: number;
  rank: number;
  score: number;
  components: InspirationComponents;
  packagingSignals: string[];
}

export type InspirationSearchResult =
  | {
      status: 'ready';
      targetName: string;
      targetTitles: string[];
      results: InspirationResult[];
      candidatePoolSize: number;
      corpusAsOf: string;
      model: string;
      recipe: string;
    }
  | { status: 'unavailable' }
  | { status: 'target_not_indexed' };

export type InspirationFeedback = 'saved' | 'dismissed';

let artifactsPromise: Promise<EvalArtifacts> | null = null;

async function evalArtifacts(): Promise<EvalArtifacts> {
  artifactsPromise ??= Promise.all([
    fs.readFile(path.join(EVAL_DIR, 'documents.json'), 'utf8'),
    fs.readFile(path.join(EVAL_DIR, 'video-corpus-evidence.json'), 'utf8'),
  ]).then(([manifestText, proofText]) => {
    const manifest = JSON.parse(manifestText) as EvalManifest;
    const rows = JSON.parse(proofText) as ProofRow[];
    if (!manifest.video_collection || !manifest.channel_collection || manifest.dimensions !== 512) {
      throw new Error('invalid semantic eval manifest');
    }
    return {
      manifest,
      proof: rows.map((row) => ({ outlier_score: Number(row.score), n_baseline: Number(row.n_baseline) })),
    };
  });
  return artifactsPromise;
}

function finiteVector(point: QdrantRetrievedPoint<unknown>, label: string, dimensions: number): number[] {
  if (!Array.isArray(point.vector) || point.vector.length !== dimensions
    || point.vector.some((value) => !Number.isFinite(value))) {
    throw new Error(`${label}: expected a finite ${dimensions}-dimensional vector`);
  }
  return point.vector;
}

function isoFromSeconds(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  const date = new Date(value * 1_000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function listInspirationTargets(userId: string): Promise<InspirationTarget[]> {
  const rows = await q<{
    channel_id: string;
    name: string;
    avatar_url: string | null;
    role: 'self' | 'competitor';
  }>(
    `select uc.channel_id,
            coalesce(nullif(cd.name, ''), nullif(cm.title, ''), uc.channel_id) as name,
            coalesce(cd.avatar_url, cm.avatar_url) as avatar_url,
            uc.role
       from user_channels uc
       left join channel_directory cd on cd.channel_id = uc.channel_id
       left join channel_meta cm on cm.channel_id = uc.channel_id
      where uc.user_id = $1
      order by (uc.role = 'self') desc, uc.added_at asc, uc.channel_id`,
    [userId],
  );
  return rows.map((row) => ({
    channelId: row.channel_id,
    name: row.name,
    avatarUrl: row.avatar_url,
    role: row.role,
  }));
}

async function readySearch(targetChannelId: string, distance: InspirationDistance): Promise<
  Exclude<InspirationSearchResult, { status: 'unavailable' }>
> {
  const { manifest, proof } = await evalArtifacts();
  const qdrant = new SemanticQdrant({ timeoutMs: 10_000 });
  let target: QdrantRetrievedPoint<ChannelPayload> & { vector: number[] };
  try {
    target = await qdrant.point<ChannelPayload>(manifest.channel_collection, targetChannelId);
  } catch (error) {
    if (error instanceof QdrantNotFoundError) {
      try {
        await qdrant.count(manifest.channel_collection);
      } catch (collectionError) {
        if (collectionError instanceof QdrantNotFoundError) {
          throw new QdrantUnavailableError(`Required Qdrant collection is missing: ${manifest.channel_collection}`);
        }
        throw collectionError;
      }
      return { status: 'target_not_indexed' };
    }
    throw error;
  }
  const targetVector = finiteVector(target, targetChannelId, manifest.dimensions);
  const targetName = target.payload.channel_name || target.payload.name;
  const targetTitles = extractChannelTitles(target.payload.document, targetName);
  let hits: Array<QdrantSearchHit<VideoPayload>>;
  try {
    hits = await qdrant.query<VideoPayload>(manifest.video_collection, targetVector, {
      limit: CANDIDATE_POOL_SIZE,
      filter: { must_not: [{ key: 'channel_id', match: { value: targetChannelId } }] },
    });
  } catch (error) {
    if (error instanceof QdrantNotFoundError) {
      throw new QdrantUnavailableError(`Required Qdrant collection is missing: ${manifest.video_collection}`);
    }
    throw error;
  }
  const sourceIds = [...new Set(hits.map((hit) => hit.payload.channel_id).filter(Boolean))];
  let sourcePoints: Array<QdrantRetrievedPoint<ChannelPayload>>;
  try {
    sourcePoints = await qdrant.points<ChannelPayload>(manifest.channel_collection, sourceIds, { withVector: true });
  } catch (error) {
    if (error instanceof QdrantNotFoundError) {
      throw new QdrantUnavailableError(`Required Qdrant collection is missing: ${manifest.channel_collection}`);
    }
    throw error;
  }
  const sources = new Map(sourcePoints.map((point) => [point.payload.channel_id, point]));

  const candidates = hits.flatMap((hit) => {
    const payload = hit.payload;
    if (!payload.video_id || !payload.channel_id || !payload.channel_name || !payload.title
      || !Number.isFinite(hit.score) || !Number.isFinite(payload.score) || !Number.isFinite(payload.n_baseline)) return [];
    const source = sources.get(payload.channel_id);
    const sourceVector = source ? finiteVector(source, payload.channel_id, manifest.dimensions) : null;
    return [{
      entity_id: payload.video_id,
      channel_id: payload.channel_id,
      title: payload.title,
      channel_name: payload.channel_name,
      thumbnail_url: payload.thumbnail_url,
      published_at: payload.published_at,
      document_affinity: hit.score,
      source_document_affinity: sourceVector ? cosineSimilarity(targetVector, sourceVector) : null,
      outlier_score: payload.score,
      n_baseline: payload.n_baseline,
    }];
  });
  const ranked = rankInspirationCandidates(candidates, targetTitles, distance, { proof_population: proof })
    .slice(0, RESULT_LIMIT);
  return {
    status: 'ready',
    targetName,
    targetTitles,
    results: ranked.map((row) => ({
      videoId: row.entity_id,
      channelId: row.channel_id,
      channelName: row.channel_name,
      title: row.title,
      thumbnailUrl: row.thumbnail_url,
      publishedAt: isoFromSeconds(row.published_at),
      outlierScore: row.outlier_score,
      baselineVideos: row.n_baseline,
      rank: row.rank,
      score: row.score,
      components: row.components,
      packagingSignals: extractTitleForm(row.title).signals,
    })),
    candidatePoolSize: candidates.length,
    corpusAsOf: manifest.as_of,
    model: manifest.model,
    recipe: INSPIRATION_RECIPE,
  };
}

export async function searchInspiration(
  targetChannelId: string,
  distance: InspirationDistance,
): Promise<InspirationSearchResult> {
  const state = await inspirationSearchState(() => readySearch(targetChannelId, distance));
  return state.status === 'unavailable' ? { status: 'unavailable' } : state.value;
}

export async function inspirationFeedbackFor(
  userId: string,
  targetChannelId: string,
  videoIds: string[],
): Promise<Record<string, InspirationFeedback>> {
  if (!videoIds.length) return {};
  if (videoIds.length > RESULT_LIMIT) throw new Error(`feedback read is limited to ${RESULT_LIMIT} videos`);
  const rows = await q<{ video_id: string; decision: InspirationFeedback }>(
    `select video_id, decision
       from inspiration_feedback
      where user_id = $1 and target_channel_id = $2 and video_id = any($3::text[])`,
    [userId, targetChannelId, videoIds],
  );
  return Object.fromEntries(rows.map((row) => [row.video_id, row.decision]));
}

export async function setInspirationFeedback(userId: string, input: InspirationFeedbackInput): Promise<void> {
  if (input.decision === 'clear') {
    await q(
      `delete from inspiration_feedback
        where user_id = $1 and target_channel_id = $2 and video_id = $3`,
      [userId, input.targetChannelId, input.videoId],
    );
    return;
  }
  const tracked = await q<{ tracked: boolean }>(
    `select exists (
       select 1 from user_channels where user_id = $1 and channel_id = $2
     ) as tracked`,
    [userId, input.targetChannelId],
  );
  if (!tracked[0]?.tracked) throw new Error('target channel is not tracked by this user');
  const currentSearch = await searchInspiration(input.targetChannelId, input.distance);
  if (currentSearch.status !== 'ready') throw new Error('inspiration result is no longer available');
  validateInspirationFeedbackReceipt(
    input,
    currentSearch.results.map((result) => ({ videoId: result.videoId, rank: result.rank })),
  );
  const rows = await q<{ video_id: string }>(
    `insert into inspiration_feedback
       (user_id, target_channel_id, video_id, distance, decision, recipe, result_rank, updated_at)
     select $1, $2, $3, $4, $5, $6, $7, now()
      where exists (
        select 1 from user_channels where user_id = $1 and channel_id = $2
      )
     on conflict (user_id, target_channel_id, video_id) do update
       set distance = excluded.distance,
           decision = excluded.decision,
           recipe = excluded.recipe,
           result_rank = excluded.result_rank,
           updated_at = now()
     returning video_id`,
    [userId, input.targetChannelId, input.videoId, input.distance, input.decision, INSPIRATION_RECIPE, input.rank],
  );
  if (!rows.length) throw new Error('target channel is not tracked by this user');
}
