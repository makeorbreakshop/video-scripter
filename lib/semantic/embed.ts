import OpenAI from 'openai';
import { get_encoding } from 'tiktoken';
import { q } from '../admin/db';
import { EMBEDDING_DIMS, EMBEDDING_MODEL } from './documents';

export const INPUT_COST_PER_MILLION = 0.02;
const MAX_BATCH_SIZE = 256;

interface EmbeddingResponse {
  data: Array<{ index: number; embedding: number[] }>;
  usage?: { prompt_tokens?: number; total_tokens?: number };
}

export interface EmbeddingClient {
  embeddings: {
    create: (params: {
      model: string;
      input: string[];
      dimensions: number;
      encoding_format: 'float';
    }) => Promise<EmbeddingResponse>;
  };
}

export function chunkEmbeddingInputs(inputs: string[], size = MAX_BATCH_SIZE): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < inputs.length; index += size) chunks.push(inputs.slice(index, index + size));
  return chunks;
}

export function embeddingCostUsd(tokens: number): number {
  return Number((tokens * INPUT_COST_PER_MILLION / 1_000_000).toPrecision(12));
}

export interface EmbeddingRunEstimate {
  docs: number;
  tokens: number;
  est_usd: number;
  usd_per_million_tokens: number;
}

export function estimateEmbeddingRun(inputs: string[]): EmbeddingRunEstimate {
  const encoding = get_encoding('cl100k_base');
  let tokens = 0;
  try {
    for (const input of inputs) tokens += encoding.encode(input).length;
  } finally {
    encoding.free();
  }
  return {
    docs: inputs.length,
    tokens,
    est_usd: embeddingCostUsd(tokens),
    usd_per_million_tokens: INPUT_COST_PER_MILLION,
  };
}

export function assertEmbeddingBudget(estimate: EmbeddingRunEstimate, maxUsd: number): void {
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) throw new Error('--max-usd must be a positive number');
  if (estimate.est_usd > maxUsd) {
    throw new Error(`Estimated embedding cost $${estimate.est_usd.toFixed(6)} exceeds --max-usd $${maxUsd.toFixed(2)}`);
  }
}

export async function logEmbeddingCost(tokens: number, usd: number): Promise<void> {
  await q(`insert into semantic_cost_ledger (date, tokens, usd) values (current_date, $1, $2)`, [tokens, usd]);
}

let client: EmbeddingClient | null = null;

function defaultClient(): EmbeddingClient {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) as unknown as EmbeddingClient;
  return client;
}

function isRateLimited(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 429;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface EmbedOptions {
  model?: string;
  dimensions?: number;
  client?: EmbeddingClient;
  sleep?: (ms: number) => Promise<void>;
  logCost?: (tokens: number, usd: number) => Promise<void>;
  maxRetries?: number;
  requestGapMs?: number;
  onUsage?: (tokens: number, usd: number) => void;
}

export async function embedTexts(inputs: string[], options: EmbedOptions = {}): Promise<number[][]> {
  const embeddingClient = options.client ?? defaultClient();
  const sleep = options.sleep ?? defaultSleep;
  const logCost = options.logCost ?? logEmbeddingCost;
  const model = options.model ?? EMBEDDING_MODEL;
  const dimensions = options.dimensions ?? EMBEDDING_DIMS;
  const maxRetries = options.maxRetries ?? 5;
  const requestGapMs = options.requestGapMs ?? 20;
  const output: number[][] = [];

  for (const batch of chunkEmbeddingInputs(inputs)) {
    let response: EmbeddingResponse | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        response = await embeddingClient.embeddings.create({
          model, input: batch, dimensions, encoding_format: 'float',
        });
        break;
      } catch (error) {
        if (!isRateLimited(error) || attempt === maxRetries) throw error;
        await sleep(500 * 2 ** attempt);
      }
    }
    if (!response) throw new Error('Embedding request completed without a response');
    const tokens = response.usage?.total_tokens ?? response.usage?.prompt_tokens ?? 0;
    const usd = embeddingCostUsd(tokens);
    await logCost(tokens, usd);
    options.onUsage?.(tokens, usd);
    output.push(...[...response.data].sort((a, b) => a.index - b.index).map((item) => item.embedding));
    if (requestGapMs > 0) await sleep(requestGapMs);
  }

  return output;
}

interface QueryCacheEntry { vector: number[]; expiresAt: number }
const queryCache = new Map<string, QueryCacheEntry>();

export function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

export async function embedQuery(query: string, ttlMs = 10 * 60_000): Promise<number[]> {
  const key = normalizeQuery(query);
  const cached = queryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.vector;
  const [vector] = await embedTexts([key]);
  queryCache.set(key, { vector, expiresAt: Date.now() + ttlMs });
  return vector;
}
