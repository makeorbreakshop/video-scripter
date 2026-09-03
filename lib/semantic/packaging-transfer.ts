export const PACKAGING_TRANSFER_RECIPE = 'j5-programmatic-packaging-v1';
export const PACKAGING_TRANSFER_VARIANTS = ['title_form', 'cross_topic', 'cross_topic_diverse'] as const;

export type PackagingTransferVariant = typeof PACKAGING_TRANSFER_VARIANTS[number];

export interface PackagingTransferCandidate {
  entity_id: string;
  channel_id: string;
  title: string;
  document_affinity: number;
  source_document_affinity: number | null;
  outlier_score: number;
  n_baseline: number;
}

export interface TitleForm {
  skeleton: string;
  signals: string[];
}

export interface PackagingTransferRanking extends PackagingTransferCandidate {
  rank: number;
  score: number;
  components: {
    title_form: number;
    document_novelty: number;
    outlier_strength: number;
  };
}

export const PACKAGING_TRANSFER_CONFIG = {
  recipe: PACKAGING_TRANSFER_RECIPE,
  weights: {
    title_form: { title_form: 0.8, document_novelty: 0, outlier_strength: 0.2 },
    cross_topic: { title_form: 0.25, document_novelty: 0.6, outlier_strength: 0.15 },
  },
  diversity: { relevance_weight: 0.85, similarity_weight: 0.15, max_per_channel_before_backfill: 2 },
} as const;

const PACKAGING_OPERATORS = new Set([
  'about', 'actually', 'after', 'and', 'before', 'best', 'bought', 'build', 'building', 'built', 'buy',
  'can', 'challenge', 'changed', 'cheap', 'compared', 'comparing', 'comparison', 'did', 'do', 'does',
  'everything', 'ever', 'expensive', 'experiment', 'finally', 'first', 'for', 'from', 'get', 'guide',
  'happened', 'happens', 'honest', 'how', 'i', 'in', 'into', 'is', 'it', 'last', 'make', 'made',
  'making', 'mistake', 'mistakes', 'my', 'never', 'no', 'now', 'only', 'or', 'our', 'review', 'reviewed',
  'ruined', 'ruining', 'secret', 'should', 'test', 'tested', 'testing', 'that', 'the', 'these', 'this',
  'those', 'to', 'top', 'tried', 'try', 'trying', 'truth', 'under', 'verdict', 'versus', 'vs', 'we',
  'were', 'what', 'when', 'why', 'will', 'with', 'without', 'worlds', 'worst', 'worth', 'would', 'you',
  'your',
]);

function bounded(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function textTokens(value: string): string[] {
  return normalizedTitle(value).match(/[\p{L}\p{N}]+/gu) ?? [];
}

function normalizedTitle(value: string): string {
  return value.normalize('NFKC').replace(/[\u2018\u2019]/gu, "'").toLocaleLowerCase('en-US');
}

function jaccard(left: Iterable<string>, right: Iterable<string>): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]);
  if (!union.size) return 0;
  let intersection = 0;
  for (const value of leftSet) if (rightSet.has(value)) intersection += 1;
  return intersection / union.size;
}

function bigrams(value: string): string[] {
  const tokens = value.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return tokens;
  return tokens.slice(0, -1).map((token, index) => `${token}\0${tokens[index + 1]}`);
}

export function normalizeTitleSkeleton(title: string): string {
  if (!title.trim()) throw new Error('title is required');
  const normalized = normalizedTitle(title)
    .replace(/[$£€]\s*\d+(?:[.,]\d+)*(?:\s*[kmb])?/giu, ' [price] ')
    .replace(/\b\d+(?:[.,]\d+)?\s*%/giu, ' [percent] ')
    .replace(/\b(?:19|20)\d{2}\b/gu, ' [year] ')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)\b/giu, ' [duration] ')
    .replace(/\b\d+(?:[.,]\d+)?\b/gu, ' [number] ');
  const tokens = normalized.match(/\[[a-z_]+\]|[\p{L}]+/gu) ?? [];
  const output: string[] = [];
  for (const token of tokens) {
    const mapped = token.startsWith('[') || PACKAGING_OPERATORS.has(token) ? token : 'subject';
    if (mapped === 'subject' && output.at(-1) === 'subject') continue;
    output.push(mapped);
  }
  return output.join(' ');
}

export function extractTitleForm(title: string): TitleForm {
  const normalized = normalizedTitle(title);
  const signals: string[] = [];
  const add = (name: string, condition: boolean) => { if (condition) signals.push(name); };
  add('build', /\b(?:build|built|building|make|made|making|diy)\b/u.test(normalized));
  add('challenge', /\b(?:challenge|challenged)\b/u.test(normalized));
  add('comparison', /\b(?:vs\.?|versus|compared?|comparison)\b/u.test(normalized)
    || /\bcheap\b.*\bexpensive\b|\bexpensive\b.*\bcheap\b/u.test(normalized));
  add('first_person', /\b(?:i|i'm|i've|my|we|we're|we've|our)\b/u.test(normalized));
  add('how_to', /^\s*how\s+to\b/u.test(normalized));
  add('list', /\b\d+\s+(?:ways|things|tips|tricks|reasons|facts|mistakes|ideas|uses)\b/u.test(normalized)
    || /^\s*(?:top|best)\s+\d+\b/u.test(normalized));
  add('novelty', /\b(?:new|first|finally|never|revolutionary|revolutionize|nobody|no one)\b/u.test(normalized));
  add('price', /[$£€]\s*\d|\b(?:cheap|expensive|cost|price|worth)\b/u.test(normalized));
  add('question', normalized.includes('?'));
  add('review', /\b(?:review|reviewed|unboxing|deep dive|hands on)\b/u.test(normalized));
  add('superlative', /\b(?:best|worst|biggest|smallest|fastest|easiest|hardest|ultimate|only|most|least)\b/u.test(normalized));
  add('test', /\b(?:test|tested|testing|tried|trying|experiment)\b/u.test(normalized));
  add('time_constraint', /\b\d+(?:[.,]\d+)?\s*(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)\b/u.test(normalized));
  add('transformation', /\bturn(?:ed|ing)?\b.*\binto\b|\bfrom\b.+\bto\b/u.test(normalized));
  add('verdict', /\b(?:verdict|worth it|honest|truth|report card)\b/u.test(normalized));
  add('warning', /\b(?:warning|mistake|mistakes|avoid|don't|dont|before you|ruining|ruined|problem|problems)\b/u.test(normalized));
  add('why', /^\s*why\b/u.test(normalized));
  return { skeleton: normalizeTitleSkeleton(title), signals: signals.sort() };
}

export function extractChannelTitles(document: string, expectedChannelName: string): string[] {
  const lines = document.normalize('NFKC').split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines[0] !== expectedChannelName.normalize('NFKC').trim()) {
    throw new Error('frozen channel identity does not match the requested seed channel');
  }
  if (lines.length !== 21) throw new Error('frozen channel document must contain exactly 20 representative titles');
  return lines.slice(1, 21);
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || !left.length) throw new Error('cosine vector dimensions must match');
  if (left.some((value) => !Number.isFinite(value)) || right.some((value) => !Number.isFinite(value))) {
    throw new Error('cosine vectors must contain finite values');
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (leftNorm === 0 || rightNorm === 0) throw new Error('cosine vectors must be non-zero');
  return dot / Math.sqrt(leftNorm * rightNorm);
}

function titleFormSimilarity(left: TitleForm, right: TitleForm): number {
  const signalSimilarity = jaccard(left.signals, right.signals);
  const skeletonSimilarity = jaccard(bigrams(left.skeleton), bigrams(right.skeleton));
  return 0.65 * signalSimilarity + 0.35 * skeletonSimilarity;
}

function titleFormCompatibility(candidate: TitleForm, targets: TitleForm[]): number {
  const similarities = targets.map((target) => titleFormSimilarity(candidate, target)).sort((left, right) => right - left);
  const top = similarities.slice(0, Math.min(3, similarities.length));
  const topMean = top.reduce((sum, value) => sum + value, 0) / top.length;
  return bounded(0.6 * similarities[0] + 0.4 * topMean);
}

function percentile(values: number[], value: number, highIsBetter: boolean): number {
  if (values.length === 1) return 0.5;
  const lower = values.filter((candidate) => candidate < value).length;
  const equal = values.filter((candidate) => candidate === value).length;
  const rank = (lower + (equal - 1) / 2) / (values.length - 1);
  return highIsBetter ? rank : 1 - rank;
}

function lexicalTitleSimilarity(left: string, right: string): number {
  return jaccard(textTokens(left).filter((token) => token.length > 1), textTokens(right).filter((token) => token.length > 1));
}

function packagingSimilarity(left: string, right: string): number {
  return Math.max(lexicalTitleSimilarity(left, right), titleFormSimilarity(extractTitleForm(left), extractTitleForm(right)));
}

function diversify(rows: PackagingTransferRanking[]): PackagingTransferRanking[] {
  const remaining = [...rows];
  const selected: PackagingTransferRanking[] = [];
  const channelCounts = new Map<string, number>();
  const maximumSimilarity = new Map(rows.map((row) => [row.entity_id, 0]));
  while (remaining.length) {
    const eligible = remaining.filter((row) => (channelCounts.get(row.channel_id) ?? 0)
      < PACKAGING_TRANSFER_CONFIG.diversity.max_per_channel_before_backfill);
    const pool = eligible.length ? eligible : remaining;
    const winner = [...pool].sort((left, right) => {
      const leftScore = PACKAGING_TRANSFER_CONFIG.diversity.relevance_weight * left.score
        - PACKAGING_TRANSFER_CONFIG.diversity.similarity_weight * (maximumSimilarity.get(left.entity_id) ?? 0);
      const rightScore = PACKAGING_TRANSFER_CONFIG.diversity.relevance_weight * right.score
        - PACKAGING_TRANSFER_CONFIG.diversity.similarity_weight * (maximumSimilarity.get(right.entity_id) ?? 0);
      return rightScore - leftScore || left.entity_id.localeCompare(right.entity_id);
    })[0];
    selected.push(winner);
    channelCounts.set(winner.channel_id, (channelCounts.get(winner.channel_id) ?? 0) + 1);
    remaining.splice(remaining.findIndex((row) => row.entity_id === winner.entity_id), 1);
    for (const row of remaining) {
      maximumSimilarity.set(row.entity_id, Math.max(
        maximumSimilarity.get(row.entity_id) ?? 0,
        packagingSimilarity(row.title, winner.title),
      ));
    }
  }
  return selected.map((row, index) => ({ ...row, rank: index + 1 }));
}

export function rankPackagingTransfer(
  candidates: PackagingTransferCandidate[],
  targetTitles: string[],
  variant: PackagingTransferVariant,
  options: { proof_population?: Array<{ outlier_score: number; n_baseline: number }> } = {},
): PackagingTransferRanking[] {
  if (!PACKAGING_TRANSFER_VARIANTS.includes(variant)) throw new Error(`unsupported packaging variant: ${variant}`);
  if (!targetTitles.length || targetTitles.some((title) => !title.trim())) throw new Error('target titles are required');
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.entity_id || !candidate.channel_id || !candidate.title.trim()) throw new Error('candidate identity and title are required');
    if (ids.has(candidate.entity_id)) throw new Error(`duplicate packaging candidate: ${candidate.entity_id}`);
    ids.add(candidate.entity_id);
    if (!Number.isFinite(candidate.document_affinity)
      || (candidate.source_document_affinity != null && !Number.isFinite(candidate.source_document_affinity))
      || !Number.isFinite(candidate.outlier_score)
      || !Number.isFinite(candidate.n_baseline)) {
      throw new Error(`${candidate.entity_id}: ranking inputs must be finite`);
    }
  }
  const proofPopulation = options.proof_population ?? candidates;
  if (!proofPopulation.length || proofPopulation.some((row) => !Number.isFinite(row.outlier_score)
    || !Number.isFinite(row.n_baseline))) throw new Error('proof population must contain finite values');
  const targetForms = targetTitles.map(extractTitleForm);
  const effectiveAffinity = (candidate: PackagingTransferCandidate) => Math.max(
    candidate.document_affinity,
    candidate.source_document_affinity ?? candidate.document_affinity,
  );
  const affinityValues = candidates.map(effectiveAffinity);
  const outlierValues = proofPopulation.map((candidate) => candidate.outlier_score);
  const baselineCounts = proofPopulation.map((candidate) => candidate.n_baseline);
  const baseVariant = variant === 'title_form' ? 'title_form' : 'cross_topic';
  const weights = PACKAGING_TRANSFER_CONFIG.weights[baseVariant];
  const ranked = candidates.map((candidate) => {
    const components = {
      title_form: titleFormCompatibility(extractTitleForm(candidate.title), targetForms),
      document_novelty: percentile(affinityValues, effectiveAffinity(candidate), false),
      outlier_strength: 0.75 * percentile(outlierValues, candidate.outlier_score, true)
        + 0.25 * percentile(baselineCounts, candidate.n_baseline, true),
    };
    const score = weights.title_form * components.title_form
      + weights.document_novelty * components.document_novelty
      + weights.outlier_strength * components.outlier_strength;
    return { ...candidate, score, components, rank: 0 };
  }).sort((left, right) => right.score - left.score || left.entity_id.localeCompare(right.entity_id))
    .map((row, index) => ({ ...row, rank: index + 1 }));
  return variant === 'cross_topic_diverse' ? diversify(ranked) : ranked;
}

export interface PackagingTransferGateMetrics {
  task_id?: string;
  lower_precision_at_k: number;
  direct_application_rate_at_k: number;
  creative_hits_at_k: number;
  unresolved_at_k: number;
  unique_channels_at_10: number;
}

export function packagingTransferGate(
  tasks: PackagingTransferGateMetrics[],
  options: { expected_task_ids?: string[] } = {},
): { passed: boolean; failures: string[] } {
  if (!tasks.length) throw new Error('at least one task is required for the packaging gate');
  const metricKeys: Array<Exclude<keyof PackagingTransferGateMetrics, 'task_id'>> = [
    'lower_precision_at_k', 'direct_application_rate_at_k', 'creative_hits_at_k',
    'unresolved_at_k', 'unique_channels_at_10',
  ];
  if (tasks.some((task) => metricKeys.some((key) => !Number.isFinite(task[key])))) {
    throw new Error('packaging gate metrics must be finite');
  }
  if (options.expected_task_ids) {
    const actual = tasks.map((task) => task.task_id ?? '').sort();
    const expected = [...options.expected_task_ids].sort();
    if (new Set(actual).size !== actual.length || new Set(expected).size !== expected.length
      || actual.length !== expected.length || actual.some((id, index) => id !== expected[index])) {
      throw new Error('packaging gate task coverage does not match the expected unique task ids');
    }
  }
  const failures: string[] = [];
  tasks.forEach((task, index) => {
    const prefix = task.task_id ?? `task ${index + 1}`;
    if (task.lower_precision_at_k < 0.3) failures.push(`${prefix}: lower_precision_at_k ${task.lower_precision_at_k} < 0.3`);
    if (task.direct_application_rate_at_k > 0.2) {
      failures.push(`${prefix}: direct_application_rate_at_k ${task.direct_application_rate_at_k} > 0.2`);
    }
    if (task.creative_hits_at_k < 1) failures.push(`${prefix}: creative_hits_at_k ${task.creative_hits_at_k} < 1`);
    if (task.unresolved_at_k > 0) failures.push(`${prefix}: unresolved_at_k ${task.unresolved_at_k} > 0`);
    if (task.unique_channels_at_10 < 8) failures.push(`${prefix}: unique_channels_at_10 ${task.unique_channels_at_10} < 8`);
  });
  return { passed: failures.length === 0, failures };
}
