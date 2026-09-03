import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { Bm25Index } from '../../lib/semantic/bm25';
import { buildV4VideoDocument } from '../../lib/semantic/documents';
import { assertEmbeddingBudget, embedTexts, estimateEmbeddingRun } from '../../lib/semantic/embed';
import {
  candidateRankingsHash,
  type FrozenV4TaskManifest,
  type RankedCandidate,
  type V4Task,
} from '../../lib/semantic/eval-v4';
import { reciprocalRankFuse, SemanticQdrant, type QdrantFilter } from '../../lib/semantic/qdrant';
import { cleanDescriptionForRetrieval, wellFormedText } from '../../lib/semantic/text';
import { chunks, costToday, db, floatArg, READ_BATCH_SIZE, runMain } from './common';

const EVAL_DIR = path.resolve('docs/prd/semantic-eval-v4');
const OUTPUT_PATH = path.join(EVAL_DIR, 'candidate-runs.json');
const REPLAY_PATH = path.join(EVAL_DIR, 'candidate-runs-replay.json');
const QUERY_VECTORS_PATH = path.join(EVAL_DIR, 'query-vectors.json');
const CANDIDATE_LIMIT = 100;
const RUN_RECIPE_VERSION = 'semantic-eval-v4-candidates-2-frozen-query-vectors';

interface DocumentManifest {
  as_of: string;
  model: string;
  dimensions: number;
  video_collection: string;
  channel_collection: string;
  videos: number;
  channels: number;
  video_documents_hash: string;
  channel_documents_hash: string;
}

interface CorpusManifest {
  content_hash: string;
  ids_hash: string;
  ids: string[];
}

interface ChannelPayload {
  entity_id: string;
  channel_id: string;
  name: string;
  channel_name: string;
  document: string;
  document_hash: string;
}

interface VideoPayload {
  entity_id: string;
  video_id: string;
  channel_id: string;
  channel_name: string;
  title: string;
  description: string;
  thumbnail_url: string | null;
  document: string;
  document_hash: string;
}

type SearchPayload = ChannelPayload | VideoPayload;

interface StoredCandidate {
  entity_id: string;
  rank: number;
  raw_score: number | null;
  document_hash: string;
}

interface CandidateSystemRun {
  system: 'lexical_bm25' | 'openai_dense' | 'rrf_control';
  latency_ms: number;
  candidates: StoredCandidate[];
}

interface TaskRun {
  task_id: string;
  lane: V4Task['lane'];
  split: V4Task['split'];
  query_recipe: string;
  excluded_entity_id?: string;
  excluded_channel_id?: string;
  systems: CandidateSystemRun[];
}

interface CandidateArtifact {
  version: 4;
  run_recipe_version: string;
  run_id: string;
  created_at: string;
  as_of: string;
  task_manifest_hash: string;
  video_corpus_hash: string;
  channel_corpus_hash: string;
  video_documents_hash: string;
  channel_documents_hash: string;
  query_vectors_hash: string;
  embedding_model: string;
  dimensions: number;
  candidate_limit: number;
  qdrant_exact: true;
  tasks: TaskRun[];
  rankings_hash: string;
  semantic_cost_today: { tokens: number; usd: number };
}

interface QueryVectorArtifact {
  version: 1;
  task_manifest_hash: string;
  video_documents_hash: string;
  channel_documents_hash: string;
  model: string;
  dimensions: number;
  preparation_latency_ms: number;
  entries: Array<{ task_id: string; query_text_hash: string; vector: number[] }>;
  content_hash: string;
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.join(EVAL_DIR, file), 'utf8')) as T;
}

function elapsedMs(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1_000_000;
}

function normalizeExact(value: string): string {
  return value.normalize('NFKC').trim().replace(/^@/, '').toLocaleLowerCase('en-US');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function loadOrFreezeQueryVectors(
  taskQueries: Array<{ task: V4Task; text: string }>,
  inputs: {
    taskManifestHash: string;
    documents: DocumentManifest;
    maxUsd: number;
  },
): Promise<QueryVectorArtifact> {
  const expectedHashes = new Map(taskQueries.map(({ task, text }) => [task.id, sha256(text)]));
  try {
    const artifact = JSON.parse(await fs.readFile(QUERY_VECTORS_PATH, 'utf8')) as QueryVectorArtifact;
    if (artifact.task_manifest_hash !== inputs.taskManifestHash
      || artifact.video_documents_hash !== inputs.documents.video_documents_hash
      || artifact.channel_documents_hash !== inputs.documents.channel_documents_hash
      || artifact.model !== inputs.documents.model
      || artifact.dimensions !== inputs.documents.dimensions
      || artifact.entries.length !== taskQueries.length
      || artifact.entries.some((entry) => expectedHashes.get(entry.task_id) !== entry.query_text_hash)) {
      throw new Error('frozen query-vector inputs do not match the current eval inputs');
    }
    const { content_hash: _contentHash, ...body } = artifact;
    if (sha256(JSON.stringify(body)) !== artifact.content_hash) throw new Error('frozen query-vector content hash mismatch');
    return artifact;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const estimate = estimateEmbeddingRun(taskQueries.map((row) => row.text));
  assertEmbeddingBudget(estimate, inputs.maxUsd);
  let actualUsd = 0;
  const started = process.hrtime.bigint();
  const vectors = await embedTexts(taskQueries.map((row) => row.text), {
    onUsage: (_tokens, usd) => { actualUsd += usd; },
  });
  if (actualUsd > inputs.maxUsd) throw new Error(`query embedding cost exceeded $${inputs.maxUsd.toFixed(2)}`);
  const body = {
    version: 1 as const,
    task_manifest_hash: inputs.taskManifestHash,
    video_documents_hash: inputs.documents.video_documents_hash,
    channel_documents_hash: inputs.documents.channel_documents_hash,
    model: inputs.documents.model,
    dimensions: inputs.documents.dimensions,
    preparation_latency_ms: elapsedMs(started),
    entries: taskQueries.map(({ task, text }, index) => ({
      task_id: task.id,
      query_text_hash: sha256(text),
      vector: vectors[index],
    })),
  };
  const artifact: QueryVectorArtifact = { ...body, content_hash: sha256(JSON.stringify(body)) };
  await fs.writeFile(QUERY_VECTORS_PATH, `${JSON.stringify(artifact)}\n`, { flag: 'wx' });
  return artifact;
}

async function scrollPayloads<T extends SearchPayload>(
  qdrant: SemanticQdrant,
  collection: string,
  expectedIds: string[],
): Promise<Map<string, T>> {
  const payloads = new Map<string, T>();
  let offset: string | number | undefined;
  do {
    const page = await qdrant.scroll<T>(collection, { limit: 1_000, offset });
    for (const point of page.points) payloads.set(point.payload.entity_id, point.payload);
    offset = page.nextPageOffset;
  } while (offset != null);
  if (payloads.size !== expectedIds.length || expectedIds.some((id) => !payloads.has(id))) {
    throw new Error(`${collection} payload coverage mismatch: ${payloads.size}/${expectedIds.length}`);
  }
  return payloads;
}

async function loadChannelHandles(ids: string[]): Promise<Map<string, string | null>> {
  const handles = new Map<string, string | null>();
  for (const batch of chunks(ids, READ_BATCH_SIZE)) {
    const result = await db().query<{ channel_id: string; handle: string | null }>(
      `select input.channel_id, cd.handle
         from unnest($1::text[]) as input(channel_id)
         join channel_directory cd on cd.channel_id = input.channel_id`,
      [batch],
    );
    for (const row of result.rows) handles.set(row.channel_id, row.handle);
  }
  if (handles.size !== ids.length) throw new Error(`channel handle coverage mismatch: ${handles.size}/${ids.length}`);
  return handles;
}

async function loadSeedVideoDocument(videoId: string): Promise<string> {
  const result = await db().query<{
    title: string;
    channel_name: string;
    description: string | null;
  }>(
    `select v.title, coalesce(v.channel_name, cm.title, v.channel_id) as channel_name, v.description
       from videos v
       left join channel_meta cm on cm.channel_id = v.channel_id
      where v.id = $1`,
    [videoId],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`missing J3 seed video ${videoId}`);
  return buildV4VideoDocument({
    title: wellFormedText(row.title),
    channelName: wellFormedText(row.channel_name),
    description: cleanDescriptionForRetrieval(row.description),
  });
}

function queryTextForTask(
  task: V4Task,
  channels: ReadonlyMap<string, ChannelPayload>,
  videos: ReadonlyMap<string, VideoPayload>,
): { text?: string; recipe: string } {
  if (task.lane === 'J1' || task.lane === 'J4') {
    return { text: task.query, recipe: `${task.lane.toLowerCase()}-literal-query-v1` };
  }
  if (task.lane === 'J2' || task.lane === 'J5') {
    const channelId = task.seed?.channel_id;
    const document = channelId ? channels.get(channelId)?.document : null;
    if (!document) throw new Error(`${task.id}: seed channel is absent from frozen channel documents`);
    return { text: document, recipe: `${task.lane.toLowerCase()}-seed-channel-document-v1` };
  }
  const videoId = task.seed && 'video_id' in task.seed ? task.seed.video_id : null;
  return {
    text: videoId ? videos.get(videoId)?.document : undefined,
    recipe: 'j3-seed-video-document-v1',
  };
}

function candidateFromPayload(payload: SearchPayload, rank: number, rawScore: number): RankedCandidate {
  if ('video_id' in payload) {
    return {
      entity_id: payload.video_id,
      title: payload.title,
      channel_name: payload.channel_name,
      description: payload.description,
      ...(payload.thumbnail_url ? { thumbnail_url: payload.thumbnail_url } : {}),
      rank,
      raw_score: rawScore,
      document_hash: payload.document_hash,
    };
  }
  return {
    entity_id: payload.channel_id,
    title: payload.name,
    channel_name: payload.channel_name,
    description: payload.document,
    rank,
    raw_score: rawScore,
    document_hash: payload.document_hash,
  };
}

function storeCandidate(candidate: RankedCandidate): StoredCandidate {
  if (typeof candidate.document_hash !== 'string') throw new Error(`candidate ${candidate.entity_id} is missing document_hash`);
  return {
    entity_id: candidate.entity_id,
    rank: candidate.rank,
    raw_score: candidate.raw_score,
    document_hash: candidate.document_hash,
  };
}

function qdrantExclusionFilter(task: V4Task): QdrantFilter | undefined {
  if (task.lane === 'J2') {
    return { must_not: [{ key: 'channel_id', match: { value: task.seed?.channel_id } }] };
  }
  if (task.lane === 'J3' && task.seed && 'video_id' in task.seed) {
    return { must_not: [{ key: 'video_id', match: { value: task.seed.video_id } }] };
  }
  if (task.lane === 'J5') {
    return { must_not: [{ key: 'channel_id', match: { value: task.seed?.channel_id } }] };
  }
  return undefined;
}

async function runCandidates(): Promise<void> {
  const maxUsd = floatArg(process.argv, '--max-usd') ?? 0.10;
  const [taskManifest, videoCorpus, channelCorpus, documents] = await Promise.all([
    readJson<FrozenV4TaskManifest>('tasks.json'),
    readJson<CorpusManifest>('video-corpus.json'),
    readJson<CorpusManifest>('channel-corpus.json'),
    readJson<DocumentManifest>('documents.json'),
  ]);
  const qdrant = new SemanticQdrant({ timeoutMs: 30_000 });
  const [videos, channels, channelHandles] = await Promise.all([
    scrollPayloads<VideoPayload>(qdrant, documents.video_collection, videoCorpus.ids),
    scrollPayloads<ChannelPayload>(qdrant, documents.channel_collection, channelCorpus.ids),
    loadChannelHandles(channelCorpus.ids),
  ]);
  const videoIndex = new Bm25Index([...videos.values()].map((payload) => ({ id: payload.video_id, text: payload.document })));
  const channelIndex = new Bm25Index([...channels.values()].map((payload) => ({ id: payload.channel_id, text: payload.document })));

  const taskQueries: Array<{ task: V4Task; text: string; recipe: string }> = [];
  for (const task of taskManifest.tasks) {
    const query = queryTextForTask(task, channels, videos);
    let text = query.text;
    if (!text && task.lane === 'J3' && task.seed && 'video_id' in task.seed) {
      text = await loadSeedVideoDocument(task.seed.video_id);
    }
    if (!text) throw new Error(`${task.id}: unable to build retrieval query`);
    taskQueries.push({ task, text, recipe: query.recipe });
  }
  const queryVectors = await loadOrFreezeQueryVectors(taskQueries, {
    taskManifestHash: taskManifest.content_hash,
    documents,
    maxUsd,
  });
  const vectorByTask = new Map(queryVectors.entries.map((entry) => [entry.task_id, entry.vector]));

  const taskRuns: TaskRun[] = [];
  for (const { task, text: queryText, recipe } of taskQueries) {
    const payloads: ReadonlyMap<string, SearchPayload> = task.lane === 'J1' || task.lane === 'J2' ? channels : videos;
    const index = task.lane === 'J1' || task.lane === 'J2' ? channelIndex : videoIndex;
    const excludedIds = new Set<string>();
    if (task.lane === 'J2' && task.seed?.channel_id) excludedIds.add(task.seed.channel_id);
    if (task.lane === 'J3' && task.seed && 'video_id' in task.seed) excludedIds.add(task.seed.video_id);
    if (task.lane === 'J5' && task.seed?.channel_id) {
      for (const payload of videos.values()) {
        if (payload.channel_id === task.seed.channel_id) excludedIds.add(payload.video_id);
      }
    }
    const boosts = new Map<string, number>();
    if (task.lane === 'J1' && task.query) {
      const normalizedQuery = normalizeExact(task.query);
      for (const payload of channels.values()) {
        const handle = channelHandles.get(payload.channel_id);
        if (normalizeExact(payload.name) === normalizedQuery || (handle && normalizeExact(handle) === normalizedQuery)) {
          boosts.set(payload.channel_id, 1_000);
        }
      }
    }

    const lexicalStart = process.hrtime.bigint();
    const lexical = index.search(queryText, CANDIDATE_LIMIT, { boosts, excludeIds: excludedIds })
      .map((hit, indexPosition) => candidateFromPayload(payloads.get(hit.id)!, indexPosition + 1, hit.score));
    const lexicalMs = elapsedMs(lexicalStart);

    const denseStart = process.hrtime.bigint();
    const queryVector = vectorByTask.get(task.id);
    if (!queryVector) throw new Error(`${task.id}: frozen query vector is missing`);
    const densePayloads = await qdrant.query<SearchPayload>(
      task.lane === 'J1' || task.lane === 'J2' ? documents.channel_collection : documents.video_collection,
      queryVector,
      { limit: CANDIDATE_LIMIT, filter: qdrantExclusionFilter(task), exact: true },
    );
    const dense = densePayloads.map((hit, indexPosition) => candidateFromPayload(hit.payload, indexPosition + 1, hit.score));
    const denseMs = elapsedMs(denseStart);

    const rrfStart = process.hrtime.bigint();
    const candidateById = new Map([...lexical, ...dense].map((candidate) => [candidate.entity_id, candidate]));
    const rrf = reciprocalRankFuse(lexical, dense, (candidate) => candidate.entity_id)
      .slice(0, CANDIDATE_LIMIT)
      .map((candidate, indexPosition) => ({
        ...candidateById.get(candidate.entity_id)!,
        rank: indexPosition + 1,
        raw_score: candidate.rrfScore,
      }));
    const rrfMs = elapsedMs(rrfStart);
    taskRuns.push({
      task_id: task.id,
      lane: task.lane,
      split: task.split,
      query_recipe: recipe,
      ...(task.lane === 'J2' && task.seed?.channel_id ? { excluded_entity_id: task.seed.channel_id } : {}),
      ...(task.lane === 'J3' && task.seed && 'video_id' in task.seed ? { excluded_entity_id: task.seed.video_id } : {}),
      ...(task.lane === 'J5' && task.seed?.channel_id ? { excluded_channel_id: task.seed.channel_id } : {}),
      systems: [
        { system: 'lexical_bm25', latency_ms: lexicalMs, candidates: lexical.map(storeCandidate) },
        { system: 'openai_dense', latency_ms: denseMs, candidates: dense.map(storeCandidate) },
        { system: 'rrf_control', latency_ms: rrfMs, candidates: rrf.map(storeCandidate) },
      ],
    });
    console.log(`${task.id}: lexical=${lexical.length} dense=${dense.length} rrf=${rrf.length}`);
  }

  const rankingRuns = taskRuns.flatMap((task) => task.systems.map((system) => ({
    task_id: task.task_id,
    system: system.system,
    candidates: system.candidates,
  })));
  const rankingsHash = candidateRankingsHash(rankingRuns);
  const runInputs = {
    recipe: RUN_RECIPE_VERSION,
    task_manifest_hash: taskManifest.content_hash,
    video_corpus_hash: videoCorpus.content_hash,
    channel_corpus_hash: channelCorpus.content_hash,
    video_documents_hash: documents.video_documents_hash,
    channel_documents_hash: documents.channel_documents_hash,
    query_vectors_hash: queryVectors.content_hash,
    candidate_limit: CANDIDATE_LIMIT,
    qdrant_exact: true,
  };
  const runId = createHash('sha256').update(JSON.stringify(runInputs)).digest('hex');
  const artifact: CandidateArtifact = {
    version: 4,
    run_recipe_version: RUN_RECIPE_VERSION,
    run_id: runId,
    created_at: new Date().toISOString(),
    as_of: documents.as_of,
    task_manifest_hash: taskManifest.content_hash,
    video_corpus_hash: videoCorpus.content_hash,
    channel_corpus_hash: channelCorpus.content_hash,
    video_documents_hash: documents.video_documents_hash,
    channel_documents_hash: documents.channel_documents_hash,
    query_vectors_hash: queryVectors.content_hash,
    embedding_model: documents.model,
    dimensions: documents.dimensions,
    candidate_limit: CANDIDATE_LIMIT,
    qdrant_exact: true,
    tasks: taskRuns,
    rankings_hash: rankingsHash,
    semantic_cost_today: await costToday(),
  };

  try {
    const existing = JSON.parse(await fs.readFile(OUTPUT_PATH, 'utf8')) as CandidateArtifact;
    if (existing.run_id !== artifact.run_id || existing.rankings_hash !== artifact.rankings_hash) {
      throw new Error(`immutable candidate run mismatch: existing=${existing.rankings_hash} replay=${artifact.rankings_hash}`);
    }
    await fs.writeFile(REPLAY_PATH, `${JSON.stringify({
      verified_at: artifact.created_at,
      run_id: artifact.run_id,
      original_rankings_hash: existing.rankings_hash,
      replay_rankings_hash: artifact.rankings_hash,
      identical: true,
      latencies_ms: taskRuns.map((task) => ({
        task_id: task.task_id,
        systems: task.systems.map((system) => ({ system: system.system, latency_ms: system.latency_ms })),
      })),
    })}\n`);
    console.log(`replay verified ${rankingsHash}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(artifact)}\n`, { flag: 'wx' });
    console.log(`wrote immutable candidate run ${rankingsHash}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) runMain(runCandidates);
