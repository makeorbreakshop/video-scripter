import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { buildV4VideoDocument, docHash } from '../../lib/semantic/documents';
import {
  candidateRankingsHash,
  validateV4TaskManifest,
  type BlindCandidate,
  type FrozenV4TaskManifest,
  type V4Task,
} from '../../lib/semantic/eval-v4';
import { buildJ5CandidateDocument, createJ5HashedEnvelope, validateJ5HashedEnvelope } from '../../lib/semantic/j5-rerank';
import { blindCandidateInputHash } from '../../lib/semantic/judgments-v4';
import {
  PACKAGING_TRANSFER_CONFIG,
  PACKAGING_TRANSFER_RECIPE,
  PACKAGING_TRANSFER_VARIANTS,
  cosineSimilarity,
  extractChannelTitles,
  rankPackagingTransfer,
  type PackagingTransferCandidate,
} from '../../lib/semantic/packaging-transfer';
import { SemanticQdrant, type QdrantRetrievedPoint } from '../../lib/semantic/qdrant';
import { runMain } from './common';

const EVAL_DIR = path.resolve('docs/prd/semantic-eval-v4');
const DIR = path.join(EVAL_DIR, 'programmatic');
const INPUT_PATH = path.join(DIR, 'dev-inputs.json');
const CONFIG_PATH = path.join(DIR, 'ranking-config.json');
const RANKINGS_PATH = path.join(DIR, 'rankings-dev.json');
const REPLAY_PATH = path.join(DIR, 'replay.json');
const DEV_TASK_IDS = ['j5-maker-transfer', 'j5-tech-transfer'];
const DIMS = 512;

interface CandidatePayload {
  video_id: string;
  channel_id: string;
  channel_name: string;
  title: string;
  document_hash: string;
  score: number;
  n_baseline: number;
  confidence: string;
}

interface ChannelPayload {
  channel_id: string;
  channel_name: string;
  name: string;
  document: string;
  document_hash: string;
}

interface CandidateRuns {
  rankings_hash: string;
  tasks: Array<{
    task_id: string;
    systems: Array<{
      system: string;
      candidates: Array<{ entity_id: string; rank: number; document_hash: string }>;
    }>;
  }>;
}

interface QueryVectors {
  content_hash: string;
  entries: Array<{ task_id: string; query_text_hash: string; vector: number[] }>;
  [key: string]: unknown;
}

interface EvidenceRow {
  id: string;
  channel_id: string;
  score: number;
  confidence: string;
  n_baseline: number;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function jsonHashWithout<T extends Record<string, unknown>>(value: T, key: keyof T): string {
  const { [key]: _ignored, ...body } = value;
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

function finiteVector(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || value.length !== DIMS || value.some((item) => !Number.isFinite(item))) {
    throw new Error(`${label}: expected a finite ${DIMS}-dimensional vector`);
  }
  return value as number[];
}

function assertLoopbackQdrant(): void {
  if (!process.env.QDRANT_URL) throw new Error('QDRANT_URL is not set');
  const hostname = new URL(process.env.QDRANT_URL).hostname;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
    throw new Error('programmatic evaluation requires a loopback QDRANT_URL');
  }
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.join(EVAL_DIR, file), 'utf8')) as T;
}

async function writeFrozen(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    const existing = JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
    if (canonical(existing) !== canonical(value)) throw new Error(`${file} already exists with different content`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await fs.writeFile(file, `${JSON.stringify(value)}\n`, { flag: 'wx' });
  }
}

function pointMap<Payload extends object>(
  points: Array<QdrantRetrievedPoint<Payload>>,
  key: keyof Payload,
): Map<string, QdrantRetrievedPoint<Payload>> {
  return new Map(points.map((point) => [String(point.payload[key]), point]));
}

async function main(): Promise<void> {
  assertLoopbackQdrant();
  const started = process.hrtime.bigint();
  const [taskManifest, blindPools, candidateRuns, devInputs, queryVectors, documents,
    evidence, thumbnailCohort] = await Promise.all([
    readJson<FrozenV4TaskManifest>('tasks.json'),
    readJson<{ judge_contract: string; tasks: Array<{ task: V4Task; rubric: Record<string, unknown>; candidates: BlindCandidate[] }> }>('blind-pools-pass-1.json'),
    readJson<CandidateRuns>('candidate-runs.json'),
    readJson<{ content_hash: string; body: { blind_pool_pass_1_hash: string; candidate_rankings_hash: string;
      tasks: Array<{ task_id: string; candidates: Array<{ blind_id: string; candidate_text: string; entity_id: string;
        judge_input_hash: string }> }> } }>('challenger/dev-inputs.json'),
    readJson<QueryVectors>('query-vectors.json'),
    readJson<{ video_collection: string; channel_collection: string; video_documents_hash: string;
      channel_documents_hash: string }>('documents.json'),
    readJson<EvidenceRow[]>('video-corpus-evidence.json'),
    readJson<{ candidates: Array<{ videoId: string }> }>('../semantic-thumbnail-cohort.json'),
  ]);

  validateV4TaskManifest(taskManifest);
  validateJ5HashedEnvelope(devInputs);
  if (candidateRankingsHash(candidateRuns.tasks.flatMap((task) => task.systems.map((system) => ({
    task_id: task.task_id, system: system.system, candidates: system.candidates,
  })))) !== candidateRuns.rankings_hash) throw new Error('candidate-runs rankings hash mismatch');
  if (candidateRuns.rankings_hash !== devInputs.body.candidate_rankings_hash
    || hash(blindPools) !== devInputs.body.blind_pool_pass_1_hash) {
    throw new Error('frozen candidate/judgment input provenance mismatch');
  }
  if (jsonHashWithout(queryVectors, 'content_hash') !== queryVectors.content_hash) {
    throw new Error('query-vector content hash mismatch');
  }

  const devTasks = taskManifest.tasks.filter((task) => DEV_TASK_IDS.includes(task.id));
  if (canonical(devTasks.map((task) => task.id)) !== canonical(DEV_TASK_IDS)) throw new Error('unexpected J5 dev task scope');
  const docHashes = new Map<string, string>();
  for (const task of candidateRuns.tasks.filter((row) => DEV_TASK_IDS.includes(row.task_id))) {
    for (const system of task.systems) for (const candidate of system.candidates) {
      const existing = docHashes.get(candidate.entity_id);
      if (existing && existing !== candidate.document_hash) throw new Error(`${candidate.entity_id}: candidate document hashes differ`);
      docHashes.set(candidate.entity_id, candidate.document_hash);
    }
  }
  const candidateIds = [...docHashes.keys()].sort();
  const evidenceById = new Map(evidence.map((row) => [row.id, row]));
  const qdrant = new SemanticQdrant({ timeoutMs: 30_000 });
  const videoPoints = pointMap(await qdrant.points<CandidatePayload>(documents.video_collection, candidateIds,
    { withVector: true }), 'video_id');
  if (videoPoints.size !== candidateIds.length) throw new Error(`Qdrant returned ${videoPoints.size}/${candidateIds.length} candidate videos`);
  const sourceChannelIds = [...new Set([...videoPoints.values()].map((point) => point.payload.channel_id))].sort();
  const seedIds = devTasks.map((task) => task.seed!.channel_id);
  const channelPoints = pointMap(await qdrant.points<ChannelPayload>(documents.channel_collection,
    [...new Set([...sourceChannelIds, ...seedIds])], { withVector: true }), 'channel_id');
  const thumbnailIds = new Set(thumbnailCohort.candidates.map((row) => row.videoId));
  const sourceCoverage = sourceChannelIds.filter((id) => channelPoints.has(id)).length;

  const exactInputsByTask = new Map(devInputs.body.tasks.map((task) => [task.task_id, task]));
  let blindDocumentMismatchCount = 0;
  const inputTasks = devTasks.map((task) => {
    const pool = blindPools.tasks.find((row) => row.task.id === task.id);
    const exactTask = exactInputsByTask.get(task.id);
    const query = queryVectors.entries.find((row) => row.task_id === task.id);
    const seed = channelPoints.get(task.seed!.channel_id);
    if (!pool || !exactTask || !query || !seed) throw new Error(`${task.id}: required frozen task input is missing`);
    const queryVector = finiteVector(query.vector, `${task.id}: query vector`);
    const seedVector = finiteVector(seed.vector, `${task.id}: seed channel vector`);
    if (query.query_text_hash !== seed.payload.document_hash || query.query_text_hash !== docHash(seed.payload.document)
      || cosineSimilarity(queryVector, seedVector) < 0.999999) {
      throw new Error(`${task.id}: seed document/query-vector binding mismatch`);
    }
    const targetTitles = extractChannelTitles(seed.payload.document, task.seed!.channel_name);
    const exactById = new Map(exactTask.candidates.map((candidate) => [candidate.entity_id, candidate]));
    const candidates = pool.candidates.map((blind) => {
      const exact = {
        blind_id: blind.blind_id,
        entity_id: blind.entity_id,
        candidate_text: buildJ5CandidateDocument(blind),
        judge_input_hash: blindCandidateInputHash(blind),
      };
      if (canonical(exact) !== canonical(exactById.get(blind.entity_id))) {
        throw new Error(`${task.id}/${blind.entity_id}: exact blind candidate binding mismatch`);
      }
      const point = videoPoints.get(blind.entity_id);
      const proof = evidenceById.get(blind.entity_id);
      if (!point || !proof) throw new Error(`${blind.entity_id}: frozen vector/proof evidence is missing`);
      const expectedDocumentHash = docHashes.get(blind.entity_id);
      if (point.payload.document_hash !== expectedDocumentHash) throw new Error(`${blind.entity_id}: Qdrant document hash mismatch`);
      if (point.payload.channel_id !== proof.channel_id || point.payload.score !== proof.score
        || point.payload.n_baseline !== proof.n_baseline || point.payload.confidence !== proof.confidence) {
        throw new Error(`${blind.entity_id}: Qdrant proof payload differs from frozen evidence`);
      }
      const blindDocumentHash = docHash(buildV4VideoDocument({
        title: blind.title, channelName: blind.channel_name, description: blind.description,
      }));
      if (blindDocumentHash !== point.payload.document_hash) blindDocumentMismatchCount += 1;
      const vector = finiteVector(point.vector, `${blind.entity_id}: video vector`);
      const source = channelPoints.get(point.payload.channel_id);
      const sourceVector = source ? finiteVector(source.vector, `${point.payload.channel_id}: source channel vector`) : null;
      return {
        blind_id: blind.blind_id,
        entity_id: blind.entity_id,
        channel_id: point.payload.channel_id,
        channel_name: blind.channel_name,
        title: blind.title,
        judge_input_hash: exact.judge_input_hash,
        blind_document_hash: blindDocumentHash,
        vector_document_hash: point.payload.document_hash,
        vector_hash: hash(vector),
        source_channel_vector_hash: sourceVector ? hash(sourceVector) : null,
        document_affinity: cosineSimilarity(queryVector, vector),
        source_document_affinity: sourceVector ? cosineSimilarity(queryVector, sourceVector) : null,
        outlier_score: proof.score,
        n_baseline: proof.n_baseline,
        confidence: proof.confidence,
      };
    }).sort((left, right) => left.entity_id.localeCompare(right.entity_id));
    return {
      task_id: task.id,
      target_channel_id: task.seed!.channel_id,
      target_channel_name: task.seed!.channel_name,
      target_document_hash: seed.payload.document_hash,
      target_vector_hash: hash(queryVector),
      target_titles: targetTitles,
      candidate_count: candidates.length,
      candidates,
    };
  });

  const config = createJ5HashedEnvelope({
    version: 1,
    recipe: PACKAGING_TRANSFER_RECIPE,
    variants: PACKAGING_TRANSFER_VARIANTS,
    sole_eligible_primary: 'cross_topic_diverse',
    config: PACKAGING_TRANSFER_CONFIG,
    gate: { per_task: { lower_precision_at_10_min: 0.3, direct_application_rate_at_10_max: 0.2,
      creative_hits_at_10_min: 1, unresolved_at_10_max: 0, unique_channels_at_10_min: 8 } },
  });
  await writeFrozen(CONFIG_PATH, config);
  const inputs = createJ5HashedEnvelope({
    version: 1,
    split: 'dev',
    source_hashes: {
      task_manifest: taskManifest.content_hash,
      blind_pool_pass_1: hash(blindPools),
      exact_blind_inputs: devInputs.content_hash,
      candidate_rankings: candidateRuns.rankings_hash,
      query_vectors: queryVectors.content_hash,
      video_corpus_evidence: hash(evidence),
      documents_manifest: hash(documents),
      thumbnail_cohort: hash(thumbnailCohort),
    },
    collections: { videos: documents.video_collection, channels: documents.channel_collection },
    corpus_proof_count: evidence.length,
    unique_candidate_count: candidateIds.length,
    candidate_task_pair_count: inputTasks.reduce((sum, task) => sum + task.candidate_count, 0),
    source_channel_vector_coverage: { found: sourceCoverage, requested: sourceChannelIds.length },
    thumbnail_overlap: { found: candidateIds.filter((id) => thumbnailIds.has(id)).length, requested: candidateIds.length },
    blind_vector_document_mismatch_count: blindDocumentMismatchCount,
    tasks: inputTasks,
  });
  await writeFrozen(INPUT_PATH, inputs);

  const proofPopulation = evidence.map((row) => ({ outlier_score: row.score, n_baseline: row.n_baseline }));
  const rankingTasks = inputTasks.map((task) => ({
    task_id: task.task_id,
    variants: Object.fromEntries(PACKAGING_TRANSFER_VARIANTS.map((variant) => {
      const candidates: PackagingTransferCandidate[] = task.candidates.map((candidate) => ({
        entity_id: candidate.entity_id,
        channel_id: candidate.channel_id,
        title: candidate.title,
        document_affinity: candidate.document_affinity,
        source_document_affinity: candidate.source_document_affinity,
        outlier_score: candidate.outlier_score,
        n_baseline: candidate.n_baseline,
      }));
      return [variant, rankPackagingTransfer(candidates, task.target_titles, variant, { proof_population: proofPopulation })];
    })),
  }));
  const rankings = createJ5HashedEnvelope({
    version: 1,
    split: 'dev',
    input_content_hash: inputs.content_hash,
    config_content_hash: config.content_hash,
    tasks: rankingTasks,
  });
  await writeFrozen(RANKINGS_PATH, rankings);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  const replay = createJ5HashedEnvelope({
    version: 1,
    verified_at: new Date().toISOString(),
    elapsed_ms: elapsedMs,
    input_content_hash: inputs.content_hash,
    config_content_hash: config.content_hash,
    rankings_content_hash: rankings.content_hash,
  });
  await fs.writeFile(REPLAY_PATH, `${JSON.stringify(replay, null, 2)}\n`);
  console.log(JSON.stringify({
    input: INPUT_PATH,
    rankings: RANKINGS_PATH,
    tasks: inputTasks.map((task) => ({ task_id: task.task_id, candidates: task.candidate_count })),
    unique_candidates: candidateIds.length,
    source_channel_vectors: `${sourceCoverage}/${sourceChannelIds.length}`,
    thumbnail_overlap: `${inputs.body.thumbnail_overlap.found}/${inputs.body.thumbnail_overlap.requested}`,
    blind_vector_document_mismatches: blindDocumentMismatchCount,
    elapsed_ms: elapsedMs,
  }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) runMain(main);
