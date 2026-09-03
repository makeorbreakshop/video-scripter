import { createHash } from 'crypto';

export type SemanticJob = 'J1' | 'J2' | 'J3' | 'J4' | 'J5';

export interface EvalQuery {
  id: string;
  query?: string;
  target_id?: string;
  channel_id?: string;
  video_id?: string;
  topic?: string;
  [key: string]: unknown;
}

export interface EvalManifestInput {
  version: number;
  jobs: Partial<Record<SemanticJob, { queries: EvalQuery[] }>>;
  rubrics: Partial<Record<SemanticJob, Record<string, unknown>>>;
}

export interface FrozenEvalManifest extends EvalManifestInput {
  frozen_at: 'FROZEN';
  content_hash: string;
}

export interface ExistingCandidate {
  query_id: string;
  entity_id: string;
}

export interface Candidate extends ExistingCandidate {
  system: string;
  rank: number;
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

export function freezeEvalManifest(input: EvalManifestInput): FrozenEvalManifest {
  const body = { version: input.version, jobs: input.jobs, rubrics: input.rubrics };
  return {
    ...input,
    frozen_at: 'FROZEN',
    content_hash: createHash('sha256').update(canonicalJson(body)).digest('hex'),
  };
}

export function validateEvalManifest(manifest: EvalManifestInput | FrozenEvalManifest): void {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const [job, config] of Object.entries(manifest.jobs) as Array<[SemanticJob, { queries: EvalQuery[] } | undefined]>) {
    if (!manifest.rubrics[job]) errors.push(`missing rubric for ${job}`);
    for (const query of config?.queries ?? []) {
      if (seen.has(query.id)) errors.push(`duplicate query id: ${query.id}`);
      seen.add(query.id);
    }
  }
  if (errors.length) throw new Error(errors.join('; '));
}

export function blindPoolId(input: { queryId: string; entityType: string; entityId: string; salt: string }): string {
  const hash = createHash('sha256')
    .update([input.salt, input.queryId, input.entityType, input.entityId].join('\0'))
    .digest('hex')
    .slice(0, 20);
  return `pool_${hash}`;
}

export function candidateIntroductions(existing: ExistingCandidate[], next: Candidate[]): Candidate[] {
  const seen = new Set(existing.map((row) => `${row.query_id}\0${row.entity_id}`));
  return next.filter((row) => !seen.has(`${row.query_id}\0${row.entity_id}`));
}

export function weightedKappa(a: number[], b: number[], maxGrade: number): number {
  if (a.length !== b.length) throw new Error('weightedKappa requires equal-length rating arrays');
  if (!a.length) return 0;
  const n = a.length;
  const observed = Array.from({ length: maxGrade + 1 }, () => Array(maxGrade + 1).fill(0));
  const aCounts = Array(maxGrade + 1).fill(0);
  const bCounts = Array(maxGrade + 1).fill(0);
  for (let i = 0; i < n; i += 1) {
    const ai = a[i];
    const bi = b[i];
    if (ai < 0 || ai > maxGrade || bi < 0 || bi > maxGrade) throw new Error('grade outside configured range');
    observed[ai][bi] += 1;
    aCounts[ai] += 1;
    bCounts[bi] += 1;
  }
  const weight = (i: number, j: number) => ((i - j) ** 2) / (maxGrade ** 2 || 1);
  let observedDisagreement = 0;
  let expectedDisagreement = 0;
  for (let i = 0; i <= maxGrade; i += 1) {
    for (let j = 0; j <= maxGrade; j += 1) {
      observedDisagreement += weight(i, j) * observed[i][j] / n;
      expectedDisagreement += weight(i, j) * (aCounts[i] * bCounts[j]) / (n * n);
    }
  }
  return expectedDisagreement === 0 ? 1 : 1 - observedDisagreement / expectedDisagreement;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

export function bootstrapMeanCi(
  values: number[],
  options: { iterations?: number; seed?: number } = {},
): { mean: number; low: number; high: number } {
  if (!values.length) return { mean: 0, low: 0, high: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const iterations = options.iterations ?? 1_000;
  const random = seededRandom(options.seed ?? 1);
  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    let sum = 0;
    for (let j = 0; j < values.length; j += 1) sum += values[Math.floor(random() * values.length)];
    samples.push(sum / values.length);
  }
  samples.sort((x, y) => x - y);
  const low = samples[Math.floor(0.025 * (samples.length - 1))];
  const high = samples[Math.ceil(0.975 * (samples.length - 1))];
  return { mean, low, high };
}
