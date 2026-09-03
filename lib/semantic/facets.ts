import { buildFacetSourceText, sourceHash } from './text';

export const SEMANTIC_FACET_PROMPT_VERSION = 'semantic_facets_v2_2026_09_03';

export type FacetConfidence = 'low' | 'medium' | 'high';

export interface FacetSourceRow {
  id: string;
  title: string;
  channelName: string;
  description?: string | null;
  topicLabel?: string | null;
}

export interface SemanticFacets {
  niche: string | null;
  purpose: string | null;
  purpose_abstract: string;
  mechanism: string | null;
  mechanism_abstract: string;
  packaging_claim: string | null;
  evidence_status: 'packaging_only';
  hook_device: string | null;
  format: string | null;
  confidence: FacetConfidence;
}

const CONFIDENCE = new Set(['low', 'medium', 'high']);

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 240) : null;
}

export function facetPromptInput(row: FacetSourceRow): {
  video_id: string;
  prompt_version: string;
  text: string;
  source_hash: string;
} {
  const text = buildFacetSourceText(row);
  return {
    video_id: row.id,
    prompt_version: SEMANTIC_FACET_PROMPT_VERSION,
    text,
    source_hash: sourceHash(text),
  };
}

export function parseFacetResult(raw: unknown): SemanticFacets {
  if (!raw || typeof raw !== 'object') throw new Error('Facet result must be an object');
  const object = raw as Record<string, unknown>;
  const purposeAbstract = nullableString(object.purpose_abstract);
  const mechanismAbstract = nullableString(object.mechanism_abstract);
  if (!purposeAbstract) throw new Error('Facet result missing purpose_abstract');
  if (!mechanismAbstract) throw new Error('Facet result missing mechanism_abstract');
  if (object.evidence_status !== 'packaging_only') throw new Error('Facet evidence_status must be packaging_only');
  const confidence = nullableString(object.confidence) ?? 'low';
  if (!CONFIDENCE.has(confidence)) throw new Error(`Invalid facet confidence: ${confidence}`);
  return {
    niche: nullableString(object.niche),
    purpose: nullableString(object.purpose),
    purpose_abstract: purposeAbstract,
    mechanism: nullableString(object.mechanism),
    mechanism_abstract: mechanismAbstract,
    packaging_claim: nullableString(object.packaging_claim),
    evidence_status: 'packaging_only',
    hook_device: nullableString(object.hook_device),
    format: nullableString(object.format),
    confidence: confidence as FacetConfidence,
  };
}
