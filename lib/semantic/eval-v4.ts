import { createHash } from 'crypto';

export type V4Lane = 'J1' | 'J2' | 'J3' | 'J4' | 'J5';
export type EvalSplit = 'dev' | 'heldout';

export interface CorpusEligibilityRow {
  id: string | null;
  channel_id: string | null;
  title: string | null;
  published_at: string | Date;
  is_short: boolean | null;
  duration: string | null;
  is_institutional: boolean | null;
  score: number | string | null;
  confidence: string | null;
  n_baseline: number | string | null;
  baseline: number | string | null;
  scored_at: string | Date;
}

interface ChannelSeed {
  channel_id: string;
  channel_name: string;
  subscriber_count: number | null;
}

interface VideoSeed {
  video_id: string;
  title: string;
  channel_id: string;
  channel_name: string;
}

export interface V4Task {
  id: string;
  lane: V4Lane;
  split: EvalSplit;
  query?: string;
  target_id?: string;
  seed?: ChannelSeed | VideoSeed;
  intent?: string;
  visual?: boolean;
}

export interface V4TaskManifestInput {
  version: 4;
  as_of: string;
  tasks: V4Task[];
  rubrics: Record<V4Lane, Record<string, unknown>>;
}

export interface FrozenV4TaskManifest extends V4TaskManifestInput {
  frozen_at: 'FROZEN';
  content_hash: string;
}

export interface V4CorpusManifestInput {
  version: 4;
  entity_type: 'video' | 'channel';
  as_of: string;
  predicate: string;
  document_recipe: string;
  ids: string[];
  source: Record<string, unknown>;
}

export interface FrozenV4CorpusManifest extends V4CorpusManifestInput {
  frozen_at: 'FROZEN';
  entity_count: number;
  ids_hash: string;
  content_hash: string;
}

export interface RankedCandidate {
  entity_id: string;
  title: string;
  channel_name: string;
  description: string;
  thumbnail_url?: string;
  rank: number;
  raw_score: number | null;
  [key: string]: unknown;
}

export interface CandidateRun {
  system: string;
  candidates: RankedCandidate[];
}

export interface CandidateRankingRun {
  task_id: string;
  system: string;
  candidates: Array<{ entity_id: string; rank: number; raw_score?: number | null }>;
}

export interface BlindCandidate {
  blind_id: string;
  task_id: string;
  entity_id: string;
  title: string;
  channel_name: string;
  description: string;
  thumbnail_url?: string;
}

export interface BlindPool {
  blind: BlindCandidate[];
  provenance: Record<string, Array<{ system: string; rank: number; raw_score: number | null }>>;
}

const EXPECTED_LANE_COUNTS: Record<V4Lane, number> = { J1: 2, J2: 3, J3: 3, J4: 4, J5: 4 };
const DAY_MS = 86_400_000;

function finiteNumber(value: number | string | null): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, sortKeys(item)]),
  );
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function manifestHash(input: V4TaskManifestInput): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function shuffled<T>(values: T[], seed: number): T[] {
  const result = [...values];
  const random = seededRandom(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

export function isEligibleCorpusRow(row: CorpusEligibilityRow, asOf: string | Date): boolean {
  const boundary = new Date(asOf).getTime();
  const publishedAt = new Date(row.published_at).getTime();
  const scoredAt = new Date(row.scored_at).getTime();
  const score = finiteNumber(row.score);
  const nBaseline = finiteNumber(row.n_baseline);
  const baseline = finiteNumber(row.baseline);
  if (!Number.isFinite(boundary) || !Number.isFinite(publishedAt) || !Number.isFinite(scoredAt)) return false;
  return nonEmpty(row.id)
    && nonEmpty(row.channel_id)
    && nonEmpty(row.title)
    && publishedAt <= boundary
    && publishedAt >= boundary - 365 * DAY_MS
    && scoredAt <= boundary
    && row.is_short !== true
    && row.duration !== 'P0D'
    && row.is_institutional !== true
    && score != null && score >= 2
    && (row.confidence === 'likely' || row.confidence === 'confirmed')
    && nBaseline != null && nBaseline >= 5
    && baseline != null && baseline >= 5_000;
}

export function validateV4TaskManifest(manifest: V4TaskManifestInput | FrozenV4TaskManifest): void {
  const errors: string[] = [];
  if (manifest.version !== 4) errors.push('version must be 4');
  if (!Number.isFinite(new Date(manifest.as_of).getTime())) errors.push('as_of must be an ISO timestamp');
  if (manifest.tasks.length !== 16) errors.push(`expected 16 tasks, received ${manifest.tasks.length}`);

  const ids = new Set<string>();
  const laneCounts: Record<V4Lane, number> = { J1: 0, J2: 0, J3: 0, J4: 0, J5: 0 };
  const splitCounts: Record<EvalSplit, number> = { dev: 0, heldout: 0 };
  for (const task of manifest.tasks) {
    if (!nonEmpty(task.id)) errors.push('task id is required');
    else if (ids.has(task.id)) errors.push(`duplicate task id: ${task.id}`);
    ids.add(task.id);
    if (!(task.lane in laneCounts)) {
      errors.push(`unsupported lane: ${String(task.lane)}`);
      continue;
    }
    laneCounts[task.lane] += 1;
    if (!(task.split in splitCounts)) errors.push(`unsupported split: ${String(task.split)}`);
    else splitCounts[task.split] += 1;
    if (!manifest.rubrics[task.lane]) errors.push(`missing rubric for ${task.lane}`);

    if (task.lane === 'J1' && (!nonEmpty(task.query) || !nonEmpty(task.target_id))) {
      errors.push(`${task.id}: J1 requires query and target_id`);
    }
    if (task.lane === 'J4' && !nonEmpty(task.query)) errors.push(`${task.id}: J4 requires query`);
    if (task.lane === 'J2' || task.lane === 'J5') {
      const seed = task.seed as ChannelSeed | undefined;
      if (!seed || !nonEmpty(seed.channel_id) || !nonEmpty(seed.channel_name)) {
        errors.push(`${task.id}: ${task.lane} requires channel seed identity`);
      }
      if (seed?.subscriber_count == null || !Number.isFinite(seed.subscriber_count) || seed.subscriber_count < 0) {
        errors.push(`${task.id}: ${task.lane} requires subscriber_count`);
      }
    }
    if (task.lane === 'J3') {
      const seed = task.seed as VideoSeed | undefined;
      if (!seed || !nonEmpty(seed.video_id) || !nonEmpty(seed.title)
        || !nonEmpty(seed.channel_id) || !nonEmpty(seed.channel_name)) {
        errors.push(`${task.id}: J3 requires video and channel seed identity`);
      }
    }
  }

  for (const [lane, expected] of Object.entries(EXPECTED_LANE_COUNTS) as Array<[V4Lane, number]>) {
    if (laneCounts[lane] !== expected) errors.push(`${lane} requires ${expected} tasks, received ${laneCounts[lane]}`);
    if (!manifest.rubrics[lane]) errors.push(`missing rubric for ${lane}`);
  }
  if (splitCounts.dev !== 8 || splitCounts.heldout !== 8) {
    errors.push(`expected 8 dev and 8 heldout tasks, received ${splitCounts.dev}/${splitCounts.heldout}`);
  }

  if ('content_hash' in manifest) {
    const body: V4TaskManifestInput = {
      version: manifest.version,
      as_of: manifest.as_of,
      tasks: manifest.tasks,
      rubrics: manifest.rubrics,
    };
    if (manifest.content_hash !== manifestHash(body)) errors.push('content_hash does not match manifest content');
  }
  if (errors.length) throw new Error(errors.join('; '));
}

export function freezeV4TaskManifest(input: V4TaskManifestInput): FrozenV4TaskManifest {
  validateV4TaskManifest(input);
  return { ...input, frozen_at: 'FROZEN', content_hash: manifestHash(input) };
}

export function freezeV4CorpusManifest(input: V4CorpusManifestInput): FrozenV4CorpusManifest {
  if (!Number.isFinite(new Date(input.as_of).getTime())) throw new Error('as_of must be an ISO timestamp');
  if (!nonEmpty(input.predicate)) throw new Error('corpus predicate is required');
  if (!nonEmpty(input.document_recipe)) throw new Error('document recipe is required');
  if (input.ids.some((id) => !nonEmpty(id))) throw new Error('corpus ids must be non-empty');
  if (new Set(input.ids).size !== input.ids.length) throw new Error('duplicate corpus id');
  const ids = [...input.ids].sort((a, b) => a.localeCompare(b));
  const idsHash = createHash('sha256').update(ids.join('\0')).digest('hex');
  const body = {
    ...input,
    ids,
    entity_count: ids.length,
    ids_hash: idsHash,
  };
  return {
    ...body,
    frozen_at: 'FROZEN',
    content_hash: createHash('sha256').update(canonicalJson(body)).digest('hex'),
  };
}

export function buildBlindPool(input: {
  task: V4Task;
  runs: CandidateRun[];
  salt: string;
  shuffle_seed: number;
}): BlindPool {
  const documents = new Map<string, Pick<RankedCandidate, 'entity_id' | 'title' | 'channel_name' | 'description' | 'thumbnail_url'>>();
  const provenance: BlindPool['provenance'] = {};
  for (const run of input.runs) {
    if (!nonEmpty(run.system)) throw new Error('candidate run system is required');
    const seenInRun = new Set<string>();
    for (const candidate of run.candidates) {
      if (!nonEmpty(candidate.entity_id) || !nonEmpty(candidate.title) || !nonEmpty(candidate.channel_name)) {
        throw new Error(`candidate from ${run.system} is missing judge-visible identity`);
      }
      if (seenInRun.has(candidate.entity_id)) throw new Error(`${run.system} returned duplicate ${candidate.entity_id}`);
      seenInRun.add(candidate.entity_id);
      const document = {
        entity_id: candidate.entity_id,
        title: candidate.title,
        channel_name: candidate.channel_name,
        description: candidate.description ?? '',
        ...(input.task.visual && candidate.thumbnail_url ? { thumbnail_url: candidate.thumbnail_url } : {}),
      };
      const existing = documents.get(candidate.entity_id);
      if (existing && canonicalJson(existing) !== canonicalJson(document)) {
        throw new Error(`candidate document mismatch for ${candidate.entity_id}`);
      }
      documents.set(candidate.entity_id, document);
      provenance[candidate.entity_id] ??= [];
      provenance[candidate.entity_id].push({
        system: run.system,
        rank: candidate.rank,
        raw_score: candidate.raw_score,
      });
    }
  }

  const candidates = [...documents.values()]
    .sort((a, b) => a.entity_id.localeCompare(b.entity_id))
    .map((candidate): BlindCandidate => ({
      blind_id: `blind_${createHash('sha256')
        .update([input.salt, input.task.id, candidate.entity_id].join('\0'))
        .digest('hex').slice(0, 20)}`,
      task_id: input.task.id,
      ...candidate,
    }));
  return { blind: shuffled(candidates, input.shuffle_seed), provenance };
}

function relevance(entityId: string, judgments: Record<string, number>): number {
  const value = judgments[entityId];
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function precisionAtK(rankedIds: string[], judgments: Record<string, number>, k: number): number {
  if (k <= 0) return 0;
  const relevant = rankedIds.slice(0, k).filter((id) => relevance(id, judgments) > 0).length;
  return relevant / k;
}

export function pooledRecallAtK(rankedIds: string[], judgments: Record<string, number>, k: number): number {
  const relevantPool = Object.values(judgments).filter((grade) => Number.isFinite(grade) && grade > 0).length;
  if (!relevantPool) return 0;
  const retrieved = new Set(rankedIds.slice(0, Math.max(0, k)).filter((id) => relevance(id, judgments) > 0));
  return retrieved.size / relevantPool;
}

function dcg(grades: number[]): number {
  return grades.reduce((sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2), 0);
}

export function ndcgAtK(rankedIds: string[], judgments: Record<string, number>, k: number): number {
  if (k <= 0) return 0;
  const actual = rankedIds.slice(0, k).map((id) => relevance(id, judgments));
  const ideal = Object.values(judgments)
    .filter((grade) => Number.isFinite(grade) && grade > 0)
    .sort((a, b) => b - a)
    .slice(0, k);
  const idealDcg = dcg(ideal);
  return idealDcg === 0 ? 0 : dcg(actual) / idealDcg;
}

export function pendingDocuments<T extends { id: string; hash: string }>(
  documents: T[],
  existingHashes: ReadonlyMap<string, string>,
): T[] {
  return documents.filter((document) => existingHashes.get(document.id) !== document.hash);
}

export function candidateRankingsHash(runs: CandidateRankingRun[]): string {
  const rankings = [...runs]
    .sort((left, right) => left.task_id.localeCompare(right.task_id) || left.system.localeCompare(right.system))
    .map((run) => ({
      task_id: run.task_id,
      system: run.system,
      candidates: [...run.candidates]
        .sort((left, right) => left.rank - right.rank || left.entity_id.localeCompare(right.entity_id))
        .map(({ entity_id, rank }) => ({ entity_id, rank })),
    }));
  return createHash('sha256').update(canonicalJson(rankings)).digest('hex');
}

export function bootstrapMeanInterval(
  values: number[],
  options: { iterations?: number; seed?: number } = {},
): { mean: number; low: number; high: number } {
  if (!values.length || values.some((value) => !Number.isFinite(value))) {
    throw new Error('bootstrap values must be a non-empty finite array');
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (values.length === 1) return { mean, low: mean, high: mean };
  const iterations = options.iterations ?? 5_000;
  if (!Number.isInteger(iterations) || iterations < 100) throw new Error('bootstrap iterations must be at least 100');
  const random = seededRandom(options.seed ?? 0x51a71c);
  const samples = Array.from({ length: iterations }, () => {
    let sum = 0;
    for (let index = 0; index < values.length; index += 1) {
      sum += values[Math.floor(random() * values.length)];
    }
    return sum / values.length;
  }).sort((left, right) => left - right);
  const quantile = (probability: number) => samples[Math.floor(probability * (samples.length - 1))];
  return { mean, low: quantile(0.025), high: quantile(0.975) };
}
