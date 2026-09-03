import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import {
  buildBlindPool,
  type CandidateRun,
  type FrozenV4TaskManifest,
  type RankedCandidate,
  type V4Task,
} from '../../lib/semantic/eval-v4';
import { SemanticQdrant } from '../../lib/semantic/qdrant';
import { runMain } from './common';

const EVAL_DIR = path.resolve('docs/prd/semantic-eval-v4');

interface CorpusManifest { ids: string[] }

interface DocumentManifest {
  video_collection: string;
  channel_collection: string;
}

interface StoredCandidate {
  entity_id: string;
  rank: number;
  raw_score: number | null;
  document_hash: string;
}

interface CandidateArtifact {
  run_id: string;
  rankings_hash: string;
  tasks: Array<{
    task_id: string;
    systems: Array<{ system: string; candidates: StoredCandidate[] }>;
  }>;
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
  channel_name: string;
  title: string;
  description: string;
  thumbnail_url: string | null;
  document_hash: string;
}

type SearchPayload = ChannelPayload | VideoPayload;

async function readJson<T>(name: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.join(EVAL_DIR, name), 'utf8')) as T;
}

function seedFor(taskId: string, pass: number): number {
  return createHash('sha256').update(`${taskId}\0${pass}`).digest().readUInt32BE(0);
}

function judgeTask(task: V4Task): Record<string, unknown> {
  const seed = task.seed
    ? 'video_id' in task.seed
      ? {
          video_id: task.seed.video_id,
          title: task.seed.title,
          channel_id: task.seed.channel_id,
          channel_name: task.seed.channel_name,
        }
      : {
          channel_id: task.seed.channel_id,
          channel_name: task.seed.channel_name,
        }
    : undefined;
  return {
    id: task.id,
    lane: task.lane,
    ...(task.query ? { query: task.query } : {}),
    ...(task.intent ? { intent: task.intent } : {}),
    ...(seed ? { seed } : {}),
  };
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
    throw new Error(`${collection} blind-pool coverage mismatch: ${payloads.size}/${expectedIds.length}`);
  }
  return payloads;
}

function visibleCandidate(stored: StoredCandidate, payload: SearchPayload): RankedCandidate {
  if (stored.document_hash !== payload.document_hash) {
    throw new Error(`document hash changed for ${stored.entity_id}`);
  }
  if ('video_id' in payload) {
    return {
      entity_id: stored.entity_id,
      title: payload.title,
      channel_name: payload.channel_name,
      description: payload.description,
      ...(payload.thumbnail_url ? { thumbnail_url: payload.thumbnail_url } : {}),
      rank: stored.rank,
      raw_score: stored.raw_score,
    };
  }
  return {
    entity_id: stored.entity_id,
    title: payload.name,
    channel_name: payload.channel_name,
    description: payload.document,
    rank: stored.rank,
    raw_score: stored.raw_score,
  };
}

function assertJudgeSafe(value: unknown): void {
  const forbidden = /^(system|rank|raw_score|score|baseline|n_baseline|view_count|subscriber_count|confidence)$/i;
  const visit = (item: unknown, pathParts: string[]): void => {
    if (Array.isArray(item)) return item.forEach((child, index) => visit(child, [...pathParts, String(index)]));
    if (!item || typeof item !== 'object') return;
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      if (forbidden.test(key)) throw new Error(`judge artifact leaks ${[...pathParts, key].join('.')}`);
      visit(child, [...pathParts, key]);
    }
  };
  visit(value, []);
}

async function buildPools(): Promise<void> {
  const [tasks, candidates, videoCorpus, channelCorpus, documents] = await Promise.all([
    readJson<FrozenV4TaskManifest>('tasks.json'),
    readJson<CandidateArtifact>('candidate-runs.json'),
    readJson<CorpusManifest>('video-corpus.json'),
    readJson<CorpusManifest>('channel-corpus.json'),
    readJson<DocumentManifest>('documents.json'),
  ]);
  const qdrant = new SemanticQdrant({ timeoutMs: 30_000 });
  const [videos, channels] = await Promise.all([
    scrollPayloads<VideoPayload>(qdrant, documents.video_collection, videoCorpus.ids),
    scrollPayloads<ChannelPayload>(qdrant, documents.channel_collection, channelCorpus.ids),
  ]);
  const taskById = new Map(tasks.tasks.map((task) => [task.id, task]));
  const passes: Record<'pass_1' | 'pass_2', unknown[]> = { pass_1: [], pass_2: [] };
  const provenance: Record<string, unknown> = {};
  const poolStats: Array<{ task_id: string; pool_size: number; overlap_all_three: number }> = [];
  for (const taskRun of candidates.tasks) {
    const task = taskById.get(taskRun.task_id);
    if (!task) throw new Error(`candidate run contains unknown task ${taskRun.task_id}`);
    const payloads: ReadonlyMap<string, SearchPayload> = task.lane === 'J1' || task.lane === 'J2' ? channels : videos;
    const runs: CandidateRun[] = taskRun.systems.map((system) => ({
      system: system.system,
      candidates: system.candidates.map((candidate) => {
        const payload = payloads.get(candidate.entity_id);
        if (!payload) throw new Error(`${task.id}: missing payload ${candidate.entity_id}`);
        return visibleCandidate(candidate, payload);
      }),
    }));
    const salt = `${candidates.run_id}\0${task.id}`;
    const first = buildBlindPool({ task, runs, salt, shuffle_seed: seedFor(task.id, 1) });
    const second = buildBlindPool({ task, runs, salt, shuffle_seed: seedFor(task.id, 2) });
    if (JSON.stringify(first.provenance) !== JSON.stringify(second.provenance)) {
      throw new Error(`${task.id}: pass provenance mismatch`);
    }
    const header = { task: judgeTask(task), rubric: tasks.rubrics[task.lane] };
    passes.pass_1.push({ ...header, candidates: first.blind });
    passes.pass_2.push({ ...header, candidates: second.blind });
    provenance[task.id] = first.provenance;
    const allThree = Object.values(first.provenance).filter((rows) => rows.length === 3).length;
    poolStats.push({ task_id: task.id, pool_size: first.blind.length, overlap_all_three: allThree });
  }
  const shared = {
    version: 4,
    candidate_run_id: candidates.run_id,
    candidate_rankings_hash: candidates.rankings_hash,
    judge_contract: 'system/rank/score/performance-blind-v1',
  };
  const passOne = { ...shared, pass: 1, tasks: passes.pass_1 };
  const passTwo = { ...shared, pass: 2, tasks: passes.pass_2 };
  assertJudgeSafe(passOne);
  assertJudgeSafe(passTwo);
  await Promise.all([
    fs.writeFile(path.join(EVAL_DIR, 'blind-pools-pass-1.json'), `${JSON.stringify(passOne)}\n`),
    fs.writeFile(path.join(EVAL_DIR, 'blind-pools-pass-2.json'), `${JSON.stringify(passTwo)}\n`),
    fs.writeFile(path.join(EVAL_DIR, 'blind-provenance.json'), `${JSON.stringify({ ...shared, tasks: provenance })}\n`),
    fs.writeFile(path.join(EVAL_DIR, 'blind-pool-stats.json'), `${JSON.stringify({ ...shared, tasks: poolStats })}\n`),
  ]);
  console.log(JSON.stringify({
    tasks: poolStats.length,
    total_candidates: poolStats.reduce((sum, row) => sum + row.pool_size, 0),
    min_pool: Math.min(...poolStats.map((row) => row.pool_size)),
    max_pool: Math.max(...poolStats.map((row) => row.pool_size)),
    judge_safe: true,
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) runMain(buildPools);
