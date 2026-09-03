import { ndcgAtK, precisionAtK } from './eval-v4';

export type J5ResolvedLabel = 'creative_adaptation' | 'direct_application' | 'background' | 'none' | 'unresolved';
export type TransferRating = 0 | 1 | 2 | 3;

export interface TransferDecision {
  task_id: string;
  candidate_id: string;
  domain_relation: 'same' | 'adjacent' | 'unrelated' | 'unknown';
  preserved_purpose: string | null;
  preserved_mechanism: string | null;
  changed_surface: string | null;
  adapted_concept: string | null;
  purpose_fit: TransferRating;
  mechanism_fit: TransferRating;
  audience_fit: TransferRating;
  mapping_specificity: TransferRating;
  verdict: Exclude<J5ResolvedLabel, 'unresolved'>;
  confidence: 'low' | 'medium' | 'high';
  blocking_reasons: string[];
}

export interface J5Facet {
  entity_id: string;
  entity_kind: 'target_channel' | 'candidate_video';
  niche: string | null;
  purpose_observed: string | null;
  purpose_abstract: string;
  mechanism_observed: string | null;
  mechanism_abstract: string;
  evidence_status: 'packaging_only';
  confidence: 'low' | 'medium' | 'high';
}

export interface J5MetricSet {
  lower_precision_at_k: number;
  upper_precision_at_k: number;
  lower_ndcg_at_20: number;
  upper_ndcg_at_20: number;
  direct_application_rate_at_k: number;
  unresolved_at_k: number;
  creative_hits_at_k: number;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function buildJ5CandidateDocument(candidate: {
  title: string;
  channel_name: string;
  description: string;
}): string {
  return `title: ${candidate.title}\nchannel: ${candidate.channel_name}\ndescription: ${candidate.description}`;
}

export function rankJ5Scores<T extends { entity_id: string; score: number }>(rows: T[]): Array<T & { rank: number }> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (!nonEmpty(row.entity_id)) throw new Error('J5 score entity_id is required');
    if (!Number.isFinite(row.score)) throw new Error(`J5 score for ${row.entity_id} must be finite`);
    if (ids.has(row.entity_id)) throw new Error(`Duplicate J5 score for ${row.entity_id}`);
    ids.add(row.entity_id);
  }
  return [...rows]
    .sort((left, right) => right.score - left.score || left.entity_id.localeCompare(right.entity_id))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function j5Metrics(
  rankedIds: string[],
  labels: Record<string, J5ResolvedLabel>,
  k = 10,
): J5MetricSet {
  const lower = Object.fromEntries(Object.entries(labels).map(([id, label]) => [id, label === 'creative_adaptation' ? 1 : 0]));
  const upper = Object.fromEntries(Object.entries(labels).map(([id, label]) => [id, label === 'creative_adaptation' || label === 'unresolved' ? 1 : 0]));
  const top = rankedIds.slice(0, k);
  return {
    lower_precision_at_k: precisionAtK(rankedIds, lower, k),
    upper_precision_at_k: precisionAtK(rankedIds, upper, k),
    lower_ndcg_at_20: ndcgAtK(rankedIds, lower, 20),
    upper_ndcg_at_20: ndcgAtK(rankedIds, upper, 20),
    direct_application_rate_at_k: top.filter((id) => labels[id] === 'direct_application').length / k,
    unresolved_at_k: top.filter((id) => labels[id] === 'unresolved').length,
    creative_hits_at_k: top.filter((id) => labels[id] === 'creative_adaptation').length,
  };
}

function rating(value: unknown, name: string): TransferRating {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 3) throw new Error(`${name} must be an integer from 0 to 3`);
  return value as TransferRating;
}

function nullableText(value: unknown, name: string): string | null {
  if (value == null) return null;
  if (!nonEmpty(value)) throw new Error(`${name} must be a non-empty string or null`);
  return value.trim().slice(0, 500);
}

export function validateTransferDecision(raw: TransferDecision): TransferDecision {
  if (!raw || typeof raw !== 'object') throw new Error('Transfer decision must be an object');
  if (!nonEmpty(raw.task_id) || !nonEmpty(raw.candidate_id)) throw new Error('Transfer decision identity is required');
  if (!['same', 'adjacent', 'unrelated', 'unknown'].includes(raw.domain_relation)) throw new Error('Invalid domain_relation');
  if (!['creative_adaptation', 'direct_application', 'background', 'none'].includes(raw.verdict)) throw new Error('Invalid transfer verdict');
  if (!['low', 'medium', 'high'].includes(raw.confidence)) throw new Error('Invalid transfer confidence');
  if (!Array.isArray(raw.blocking_reasons) || raw.blocking_reasons.some((reason) => !nonEmpty(reason))) {
    throw new Error('blocking_reasons must be strings');
  }
  const decision: TransferDecision = {
    ...raw,
    preserved_purpose: nullableText(raw.preserved_purpose, 'preserved_purpose'),
    preserved_mechanism: nullableText(raw.preserved_mechanism, 'preserved_mechanism'),
    changed_surface: nullableText(raw.changed_surface, 'changed_surface'),
    adapted_concept: nullableText(raw.adapted_concept, 'adapted_concept'),
    purpose_fit: rating(raw.purpose_fit, 'purpose_fit'),
    mechanism_fit: rating(raw.mechanism_fit, 'mechanism_fit'),
    audience_fit: rating(raw.audience_fit, 'audience_fit'),
    mapping_specificity: rating(raw.mapping_specificity, 'mapping_specificity'),
    blocking_reasons: raw.blocking_reasons.map((reason) => reason.trim().slice(0, 240)),
  };
  if ((decision.domain_relation === 'same' || decision.domain_relation === 'adjacent')
    && decision.verdict !== 'direct_application') {
    throw new Error('creative_adaptation is invalid for same or adjacent domains; verdict must be direct_application');
  }
  if (decision.verdict === 'creative_adaptation') {
    const completeMapping = decision.preserved_purpose && decision.preserved_mechanism
      && decision.changed_surface && decision.adapted_concept;
    const ratingsPass = decision.purpose_fit >= 2 && decision.mechanism_fit >= 2
      && decision.audience_fit >= 2 && decision.mapping_specificity >= 2;
    if (decision.domain_relation !== 'unrelated' || !completeMapping || !ratingsPass) {
      throw new Error('creative_adaptation requires an unrelated domain, a complete mapping, and ratings of at least 2');
    }
  }
  return decision;
}

export function validateJ5Facet(raw: J5Facet): J5Facet {
  if (!raw || typeof raw !== 'object') throw new Error('J5 facet must be an object');
  if (!nonEmpty(raw.entity_id)) throw new Error('J5 facet entity_id is required');
  if (raw.entity_kind !== 'target_channel' && raw.entity_kind !== 'candidate_video') throw new Error('Invalid J5 facet entity_kind');
  if (raw.evidence_status !== 'packaging_only') throw new Error('J5 facet evidence_status must be packaging_only');
  if (!['low', 'medium', 'high'].includes(raw.confidence)) throw new Error('Invalid J5 facet confidence');
  const purposeAbstract = nullableText(raw.purpose_abstract, 'purpose_abstract');
  const mechanismAbstract = nullableText(raw.mechanism_abstract, 'mechanism_abstract');
  if (!purposeAbstract) throw new Error('J5 facet purpose_abstract is required');
  if (!mechanismAbstract) throw new Error('J5 facet mechanism_abstract is required');
  return {
    ...raw,
    niche: nullableText(raw.niche, 'niche'),
    purpose_observed: nullableText(raw.purpose_observed, 'purpose_observed'),
    purpose_abstract: purposeAbstract,
    mechanism_observed: nullableText(raw.mechanism_observed, 'mechanism_observed'),
    mechanism_abstract: mechanismAbstract,
  };
}

export function transferRankScore(decision: TransferDecision): number {
  const bucket = { creative_adaptation: 3, background: 2, none: 1, direct_application: 0 }[decision.verdict];
  const confidence = { high: 0.2, medium: 0.1, low: 0 }[decision.confidence];
  return bucket * 100
    + decision.purpose_fit * 10
    + decision.mechanism_fit * 6
    + decision.audience_fit * 3
    + decision.mapping_specificity
    + confidence;
}

export function selectJ5Variant(variants: Array<{ name: string; task_metrics: J5MetricSet[] }>): string | null {
  const eligible = variants.flatMap((variant) => {
    if (!variant.task_metrics.length
      || variant.task_metrics.some((metrics) => metrics.unresolved_at_k > 0 || metrics.creative_hits_at_k === 0)) return [];
    const mean = (key: keyof J5MetricSet) => variant.task_metrics.reduce((sum, metrics) => sum + metrics[key], 0)
      / variant.task_metrics.length;
    if (mean('lower_precision_at_k') < 0.3 || mean('direct_application_rate_at_k') > 0.2) return [];
    return [{ name: variant.name, lower_ndcg: mean('lower_ndcg_at_20'), upper_ndcg: mean('upper_ndcg_at_20') }];
  });
  if (!eligible.length) return null;
  const lowerWinner = [...eligible].sort((left, right) => right.lower_ndcg - left.lower_ndcg || left.name.localeCompare(right.name))[0];
  const upperWinner = [...eligible].sort((left, right) => right.upper_ndcg - left.upper_ndcg || left.name.localeCompare(right.name))[0];
  return lowerWinner.name === upperWinner.name ? lowerWinner.name : null;
}
