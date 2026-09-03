import { QdrantUnavailableError } from './qdrant';
import { extractTitleForm, titleFormCompatibility } from './packaging-transfer';

export const INSPIRATION_RECIPE = 'inspiration-sandbox-v1';
export const INSPIRATION_DISTANCES = ['near', 'balanced', 'far'] as const;
export type InspirationDistance = typeof INSPIRATION_DISTANCES[number];

export interface InspirationCandidate {
  entity_id: string;
  channel_id: string;
  title: string;
  document_affinity: number;
  source_document_affinity: number | null;
  outlier_score: number;
  n_baseline: number;
}

export interface InspirationComponents {
  packaging_form: number;
  content_proximity: number;
  distance_fit: number;
  outlier_strength: number;
}

export type InspirationRanking<T extends InspirationCandidate = InspirationCandidate> = T & {
  rank: number;
  score: number;
  components: InspirationComponents;
};

export const INSPIRATION_CONFIG = {
  recipe: INSPIRATION_RECIPE,
  weights: {
    near: { packaging_form: 0.25, distance_fit: 0.6, outlier_strength: 0.15 },
    balanced: { packaging_form: 0.35, distance_fit: 0.45, outlier_strength: 0.2 },
    far: { packaging_form: 0.25, distance_fit: 0.6, outlier_strength: 0.15 },
  },
  max_per_channel_before_backfill: 2,
} as const;

function bounded(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function percentileRanks(valuesById: Array<{ id: string; value: number }>): Map<string, number> {
  if (valuesById.length === 1) return new Map([[valuesById[0].id, 0.5]]);
  const sorted = [...valuesById].sort((left, right) => left.value - right.value || left.id.localeCompare(right.id));
  const ranks = new Map<string, number>();
  let start = 0;
  while (start < sorted.length) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].value === sorted[start].value) end += 1;
    const averageIndex = (start + end - 1) / 2;
    for (let index = start; index < end; index += 1) ranks.set(sorted[index].id, averageIndex / (sorted.length - 1));
    start = end;
  }
  return ranks;
}

function percentileInSorted(sorted: number[], value: number): number {
  if (sorted.length === 1) return 0.5;
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sorted[middle] < value) low = middle + 1;
    else high = middle;
  }
  const lower = low;
  high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sorted[middle] <= value) low = middle + 1;
    else high = middle;
  }
  const equal = low - lower;
  return bounded((lower + (equal - 1) / 2) / (sorted.length - 1));
}

function distanceFit(proximity: number, distance: InspirationDistance): number {
  if (distance === 'near') return proximity;
  if (distance === 'far') return 1 - proximity;
  return bounded(1 - 2 * Math.abs(proximity - 0.5));
}

function diverseFirstPage<T extends InspirationCandidate>(rows: Array<InspirationRanking<T>>): Array<InspirationRanking<T>> {
  const accepted: Array<InspirationRanking<T>> = [];
  const overflow: Array<InspirationRanking<T>> = [];
  const counts = new Map<string, number>();
  for (const row of rows) {
    const count = counts.get(row.channel_id) ?? 0;
    if (count < INSPIRATION_CONFIG.max_per_channel_before_backfill) {
      accepted.push(row);
      counts.set(row.channel_id, count + 1);
    } else {
      overflow.push(row);
    }
  }
  return [...accepted, ...overflow].map((row, index) => ({ ...row, rank: index + 1 }));
}

export function parseInspirationDistance(value: string | string[] | undefined): InspirationDistance {
  const candidate = Array.isArray(value) ? value[0] : value;
  return INSPIRATION_DISTANCES.includes(candidate as InspirationDistance)
    ? candidate as InspirationDistance
    : 'balanced';
}

export function rankInspirationCandidates<T extends InspirationCandidate>(
  candidates: T[],
  targetTitles: string[],
  distance: InspirationDistance,
  options: { proof_population?: Array<{ outlier_score: number; n_baseline: number }> } = {},
): Array<InspirationRanking<T>> {
  if (!INSPIRATION_DISTANCES.includes(distance)) throw new Error(`unsupported inspiration distance: ${distance}`);
  if (!targetTitles.length || targetTitles.some((title) => !title.trim())) throw new Error('target titles are required');
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.entity_id || !candidate.channel_id || !candidate.title.trim()) {
      throw new Error('candidate identity and title are required');
    }
    if (ids.has(candidate.entity_id)) throw new Error(`duplicate inspiration candidate: ${candidate.entity_id}`);
    ids.add(candidate.entity_id);
    if (!Number.isFinite(candidate.document_affinity)
      || (candidate.source_document_affinity != null && !Number.isFinite(candidate.source_document_affinity))
      || !Number.isFinite(candidate.outlier_score)
      || !Number.isFinite(candidate.n_baseline)) {
      throw new Error(`${candidate.entity_id}: ranking inputs must be finite`);
    }
  }
  if (!candidates.length) return [];
  const proofPopulation = options.proof_population ?? candidates;
  if (!proofPopulation.length || proofPopulation.some((row) => !Number.isFinite(row.outlier_score)
    || !Number.isFinite(row.n_baseline))) throw new Error('proof population must contain finite values');

  const effectiveAffinity = (candidate: InspirationCandidate) => Math.max(
    candidate.document_affinity,
    candidate.source_document_affinity ?? candidate.document_affinity,
  );
  const affinityRanks = percentileRanks(candidates.map((row) => ({ id: row.entity_id, value: effectiveAffinity(row) })));
  const outlierValues = proofPopulation.map((row) => row.outlier_score).sort((left, right) => left - right);
  const baselineValues = proofPopulation.map((row) => row.n_baseline).sort((left, right) => left - right);
  const proofFor = (candidate: InspirationCandidate) => {
    const outlierRank = percentileInSorted(outlierValues, candidate.outlier_score);
    const baselineRank = percentileInSorted(baselineValues, candidate.n_baseline);
    return 0.75 * outlierRank + 0.25 * baselineRank;
  };

  const weights = INSPIRATION_CONFIG.weights[distance];
  const targetForms = targetTitles.map(extractTitleForm);
  const ranked = candidates.map((candidate) => {
    const contentProximity = affinityRanks.get(candidate.entity_id) ?? 0;
    const components: InspirationComponents = {
      packaging_form: titleFormCompatibility(extractTitleForm(candidate.title), targetForms),
      content_proximity: contentProximity,
      distance_fit: distanceFit(contentProximity, distance),
      outlier_strength: proofFor(candidate),
    };
    const score = weights.packaging_form * components.packaging_form
      + weights.distance_fit * components.distance_fit
      + weights.outlier_strength * components.outlier_strength;
    return { ...candidate, components, score, rank: 0 };
  }).sort((left, right) => right.score - left.score || left.entity_id.localeCompare(right.entity_id));

  return diverseFirstPage(ranked);
}

export async function inspirationSearchState<T>(search: () => Promise<T>): Promise<
  { status: 'ready'; value: T } | { status: 'unavailable' }
> {
  try {
    return { status: 'ready', value: await search() };
  } catch (error) {
    if (error instanceof QdrantUnavailableError) return { status: 'unavailable' };
    throw error;
  }
}
