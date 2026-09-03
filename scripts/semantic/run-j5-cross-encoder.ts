import { createHash } from 'crypto';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { j5Metrics, rankJ5Scores, type J5ResolvedLabel } from '../../lib/semantic/j5-rerank';
import { SemanticQdrant } from '../../lib/semantic/qdrant';
import { chunks, runMain } from './common';

const EVAL_DIR = path.resolve('docs/prd/semantic-eval-v4');
const CHALLENGER_DIR = path.join(EVAL_DIR, 'challenger');
const INPUT_PATH = path.join(CHALLENGER_DIR, 'dev-inputs.json');
const RAW_PATH = path.join(CHALLENGER_DIR, 'cross-encoder-raw.json');
const OUTPUT_PATH = path.join(CHALLENGER_DIR, 'cross-encoder-dev.json');
const PYTHON = path.resolve('tmp/semantic-thumbnails-venv/bin/python');

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function textHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
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

async function runPython(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(PYTHON, ['scripts/semantic/run-j5-cross-encoder.py', '--input', INPUT_PATH, '--output', RAW_PATH], {
      cwd: process.cwd(), stdio: 'inherit', env: process.env,
    });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`cross-encoder exited ${code}`)));
  });
}

async function main(): Promise<void> {
  const [taskManifest, candidateRuns, blindPools, judgments, queryVectors] = await Promise.all([
    readJson<{ content_hash: string; tasks: Array<{ id: string; lane: string; split: string; seed?: { channel_id: string } }> }>('tasks.json'),
    readJson<{ rankings_hash: string; tasks: Array<{ task_id: string; systems: Array<{ system: string; candidates: Array<{ entity_id: string; rank: number; document_hash: string }> }> }> }>('candidate-runs.json'),
    readJson<{ tasks: Array<{ task: { id: string }; candidates: Array<{ entity_id: string; title: string; channel_name: string; description: string }> }> }>('blind-pools-pass-1.json'),
    readJson<{ candidate_rankings_hash: string; judgments: Array<{ task_id: string; entity_id: string; resolved: J5ResolvedLabel }> }>('resolved-judgments.json'),
    readJson<{ content_hash: string; entries: Array<{ task_id: string; query_text_hash: string }> }>('query-vectors.json'),
  ]);
  if (candidateRuns.rankings_hash !== judgments.candidate_rankings_hash) throw new Error('judgments do not match candidate rankings');
  const qdrant = new SemanticQdrant({ timeoutMs: 15_000 });
  const devTasks = taskManifest.tasks.filter((task) => task.lane === 'J5' && task.split === 'dev');
  const tasks = [];
  for (const task of devTasks) {
    if (!task.seed?.channel_id) throw new Error(`${task.id}: missing seed channel`);
    const seedPoint = await qdrant.point<{ channel_id: string; document: string; document_hash: string }>('channels_eval_v4', task.seed.channel_id);
    const expectedQueryHash = queryVectors.entries.find((row) => row.task_id === task.id)?.query_text_hash;
    if (!expectedQueryHash || textHash(seedPoint.payload.document) !== expectedQueryHash) throw new Error(`${task.id}: seed query hash mismatch`);
    const blindTask = blindPools.tasks.find((row) => row.task.id === task.id);
    const runTask = candidateRuns.tasks.find((row) => row.task_id === task.id);
    if (!blindTask || !runTask) throw new Error(`${task.id}: frozen pool missing`);
    const sourceById = new Map<string, Array<{ system: string; rank: number }>>();
    const documentHashById = new Map<string, string>();
    for (const system of runTask.systems) for (const candidate of system.candidates) {
      const rows = sourceById.get(candidate.entity_id) ?? [];
      rows.push({ system: system.system, rank: candidate.rank });
      sourceById.set(candidate.entity_id, rows);
      const prior = documentHashById.get(candidate.entity_id);
      if (prior && prior !== candidate.document_hash) throw new Error(`${candidate.entity_id}: conflicting document hashes`);
      documentHashById.set(candidate.entity_id, candidate.document_hash);
    }
    const poolIds = new Set(sourceById.keys());
    if (new Set(blindTask.candidates.map((candidate) => candidate.entity_id)).size !== poolIds.size) {
      throw new Error(`${task.id}: blind pool does not match candidate union`);
    }
    const videoPayloads = new Map<string, { video_id: string; document: string; document_hash: string }>();
    for (const batch of chunks([...poolIds], 50)) {
      const points = await Promise.all(batch.map((id) => qdrant.point<{ video_id: string; document: string; document_hash: string }>('videos_eval_v4', id)));
      for (const point of points) videoPayloads.set(point.payload.video_id, point.payload);
    }
    const candidates = [...poolIds].map((entityId) => {
      const payload = videoPayloads.get(entityId);
      if (!payload || payload.document_hash !== documentHashById.get(entityId) || textHash(payload.document) !== payload.document_hash) {
        throw new Error(`${entityId}: frozen Qdrant candidate document hash mismatch`);
      }
      return { entity_id: entityId, document: payload.document, document_hash: payload.document_hash };
    }).sort((left, right) => left.entity_id.localeCompare(right.entity_id));
    if (candidates.length !== poolIds.size) throw new Error(`${task.id}: incomplete candidate documents`);
    tasks.push({ task_id: task.id, seed_channel_id: task.seed.channel_id, seed_document: seedPoint.payload.document,
      seed_document_hash: seedPoint.payload.document_hash, candidates });
  }
  const body = {
    task_manifest_hash: taskManifest.content_hash,
    candidate_rankings_hash: candidateRuns.rankings_hash,
    query_vectors_hash: queryVectors.content_hash,
    query_recipe: 'j5-seed-channel-document-v1',
    document_recipe: 'title-channel-clean-description-v1',
    tasks,
  };
  const input = { version: 1, split: 'dev', body, content_hash: hash(body) };
  await writeFrozen(INPUT_PATH, input);
  await runPython();
  const rawEnvelope = JSON.parse(await fs.readFile(RAW_PATH, 'utf8')) as { version: number; content_hash: string; body_json: string };
  if (textHash(rawEnvelope.body_json) !== rawEnvelope.content_hash) throw new Error('raw cross-encoder artifact byte hash mismatch');
  const raw = { content_hash: rawEnvelope.content_hash, body: JSON.parse(rawEnvelope.body_json) as {
    input_content_hash: string; model: string; model_revision: string; model_files_sha256: Record<string, string>;
      max_length: number; batch_size: number; runtime: Record<string, unknown>; tasks: Array<{ task_id: string; candidate_count: number;
        truncated_pair_count: number; max_untruncated_tokens: number; timing_ms: number[]; scores: Array<{ entity_id: string; score: number }> }> } };
  if (raw.body.input_content_hash !== input.content_hash) throw new Error('raw cross-encoder input hash mismatch');
  const outputTasks = raw.body.tasks.map((rawTask) => {
    const ranked = rankJ5Scores(rawTask.scores);
    const labels = Object.fromEntries(judgments.judgments.filter((row) => row.task_id === rawTask.task_id)
      .map((row) => [row.entity_id, row.resolved]));
    return { ...rawTask, scores: undefined, rankings: ranked, metrics: j5Metrics(ranked.map((row) => row.entity_id), labels) };
  });
  const outputBody = { input_content_hash: input.content_hash, raw_content_hash: raw.content_hash,
    model: raw.body.model, model_revision: raw.body.model_revision, model_files_sha256: raw.body.model_files_sha256, max_length: raw.body.max_length,
    batch_size: raw.body.batch_size, runtime: raw.body.runtime, tasks: outputTasks };
  await writeFrozen(OUTPUT_PATH, { version: 1, split: 'dev', variant: 'cross_encoder', body: outputBody, content_hash: hash(outputBody) });
  console.log(JSON.stringify({ output: OUTPUT_PATH, tasks: outputTasks.map((task) => ({ task_id: task.task_id, metrics: task.metrics })) }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) runMain(main);
