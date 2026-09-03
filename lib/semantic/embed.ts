import OpenAI from 'openai';
import { q } from '../admin/db';
import { EMBEDDING_DIMS, EMBEDDING_MODEL } from './documents';

const INPUT_COST_PER_MILLION = 0.02;
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
    const tokens = response.usage?.prompt_tokens ?? response.usage?.total_tokens ?? 0;
    await logCost(tokens, embeddingCostUsd(tokens));
    output.push(...[...response.data].sort((a, b) => a.index - b.index).map((item) => item.embedding));
    if (requestGapMs > 0) await sleep(requestGapMs);
  }

  return output;
}

interface QueryCacheEntry { vector: number[]; expiresAt: number }
const queryCache = new Map<string, QueryCacheEntry>();

export async function embedQuery(query: string, ttlMs = 10 * 60_000): Promise<number[]> {
  const key = query.trim();
  const cached = queryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.vector;
  const [vector] = await embedTexts([key]);
  queryCache.set(key, { vector, expiresAt: Date.now() + ttlMs });
  return vector;
}
