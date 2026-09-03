import { NextResponse } from 'next/server';
import { jsonError } from '../api/v1';
import { QdrantUnavailableError } from './qdrant';

export function isSemanticUnavailable(error: unknown): boolean {
  if (error instanceof QdrantUnavailableError) return true;
  if (typeof error !== 'object' || error === null || !('status' in error)) return false;
  const status = Number(error.status);
  return status === 429 || status >= 500;
}

export function semanticUnavailableResponse(): NextResponse {
  return jsonError(503, 'semantic_unavailable', 'Semantic search is temporarily unavailable.');
}

export interface MatchEvidence {
  semantic_fields: string[];
  lexical_fields: string[];
  matched_niches: string[];
}

function words(value: string): string[] {
  return value.toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]+/gu)?.map((word) => word.replace(/s$/, '')) ?? [];
}

export function channelMatchEvidence(query: string, topNiches: string[]): MatchEvidence {
  const queryWords = new Set(words(query));
  const matchedNiches = topNiches.filter((niche) => words(niche).some((word) => queryWords.has(word))).slice(0, 3);
  return { semantic_fields: ['top_titles', 'top_niches'], lexical_fields: [], matched_niches: matchedNiches };
}

export function lexicalMatchEvidence(
  query: string,
  name: string,
  handle: string | null,
  matchedNiches: string[] = [],
): MatchEvidence {
  const normalized = words(query).join(' ');
  const queryWords = new Set(words(query));
  const squashed = normalized.replace(/\s/g, '');
  const lexicalFields: string[] = [];
  if (words(name).some((word) => queryWords.has(word)) || words(name).join(' ').includes(normalized)) lexicalFields.push('name');
  if (handle?.toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]/gu, '').includes(squashed)) lexicalFields.push('handle');
  return { semantic_fields: [], lexical_fields: lexicalFields.slice(0, 3), matched_niches: matchedNiches.slice(0, 3) };
}

export function diversifyByChannel<T extends { channel_id: string }>(items: T[], maxPerChannel: number, limit: number): T[] {
  if (maxPerChannel === 0) return items.slice(0, limit);
  const counts = new Map<string, number>();
  const output: T[] = [];
  for (const item of items) {
    const count = counts.get(item.channel_id) ?? 0;
    if (count >= maxPerChannel) continue;
    counts.set(item.channel_id, count + 1);
    output.push(item);
    if (output.length === limit) break;
  }
  return output;
}
