import { createHash } from 'crypto';

const UUID_URL_NAMESPACE = '6ba7b8119dad11d180b400c04fd430c8';

export const VIDEOS_COLLECTION = 'videos_v1';
export const CHANNELS_COLLECTION = 'channels_v1';

export class QdrantUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'QdrantUnavailableError';
  }
}

export class QdrantNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QdrantNotFoundError';
  }
}

export function uuid5ForId(id: string): string {
  const namespace = Buffer.from(UUID_URL_NAMESPACE, 'hex');
  const bytes = createHash('sha1').update(namespace).update(id, 'utf8').digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type FusionSource = 'lexical' | 'semantic' | 'both';

export function reciprocalRankFuseMany<T>(
  lists: T[][],
  idFor: (item: T) => string,
  k = 60,
): Array<T & { rrfScore: number }> {
  const fused = new Map<string, { item: T; score: number }>();
  for (const items of lists) {
    items.forEach((item, index) => {
      const id = idFor(item);
      const current = fused.get(id) ?? { item, score: 0 };
      current.score += 1 / (k + index + 1);
      fused.set(id, current);
    });
  }
  return [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .map(({ item, score }) => ({ ...item, rrfScore: score }));
}

export function reciprocalRankFuse<T>(
  lexical: T[],
  semantic: T[],
  idFor: (item: T) => string,
  k = 60,
): Array<T & { rrfScore: number; source: FusionSource }> {
  const fused = new Map<string, { item: T; score: number; lexical: boolean; semantic: boolean }>();
  const add = (items: T[], source: 'lexical' | 'semantic') => {
    items.forEach((item, index) => {
      const id = idFor(item);
      const current = fused.get(id) || { item, score: 0, lexical: false, semantic: false };
      current.score += 1 / (k + index + 1);
      current[source] = true;
      fused.set(id, current);
    });
  };
  add(lexical, 'lexical');
  add(semantic, 'semantic');
  return [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .map(({ item, score, lexical: inLexical, semantic: inSemantic }) => ({
      ...item,
      rrfScore: score,
      source: inLexical && inSemantic ? 'both' : inLexical ? 'lexical' : 'semantic',
    }));
}

export async function runWithLexicalFallback<T>(
  semantic: () => Promise<T>,
  lexical: () => Promise<T>,
): Promise<{ value: T; fellBack: boolean }> {
  try {
    return { value: await semantic(), fellBack: false };
  } catch (error) {
    if (!(error instanceof QdrantUnavailableError)) throw error;
    return { value: await lexical(), fellBack: true };
  }
}

export function semanticUnavailablePayload() {
  return {
    status: 503,
    body: { error: { code: 'semantic_unavailable', message: 'Semantic search is temporarily unavailable.' } },
  } as const;
}

export interface QdrantPoint<Payload = Record<string, unknown>> {
  id: string;
  vector: number[];
  payload: Payload;
}

export interface QdrantSearchHit<Payload = Record<string, unknown>> {
  id: string | number;
  score: number;
  payload: Payload;
  vector?: number[];
}

export interface QdrantFilter {
  must?: Array<Record<string, unknown>>;
  must_not?: Array<Record<string, unknown>>;
  should?: Array<Record<string, unknown>>;
}

export class SemanticQdrant {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;

  constructor(options: { url?: string; apiKey?: string; timeoutMs?: number } = {}) {
    this.baseUrl = (options.url ?? process.env.QDRANT_URL ?? '').replace(/\/$/, '');
    this.apiKey = options.apiKey ?? process.env.QDRANT_API_KEY;
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.baseUrl) throw new QdrantUnavailableError('QDRANT_URL is not set');
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey ? { 'api-key': this.apiKey } : {}),
          ...init.headers,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.status === 404) throw new QdrantNotFoundError(`Qdrant resource not found: ${path}`);
      if (!response.ok) throw new QdrantUnavailableError(`Qdrant returned HTTP ${response.status}`);
      return await response.json() as T;
    } catch (error) {
      if (error instanceof QdrantNotFoundError || error instanceof QdrantUnavailableError) throw error;
      throw new QdrantUnavailableError('Unable to reach Qdrant', { cause: error });
    }
  }

  async upsert<Payload>(collection: string, points: Array<QdrantPoint<Payload>>): Promise<void> {
    if (!points.length) return;
    await this.request(`/collections/${collection}/points?wait=true`, {
      method: 'PUT', body: JSON.stringify({ points }),
    });
  }

  async point<Payload>(collection: string, rawId: string): Promise<QdrantSearchHit<Payload> & { vector: number[] }> {
    const response = await this.request<{ result: QdrantSearchHit<Payload> & { vector: number[] } }>(
      `/collections/${collection}/points/${uuid5ForId(rawId)}?with_payload=true&with_vector=true`,
    );
    return response.result;
  }

  async query<Payload>(
    collection: string,
    vector: number[],
    options: { limit?: number; filter?: QdrantFilter; scoreThreshold?: number; withVector?: boolean; exact?: boolean } = {},
  ): Promise<Array<QdrantSearchHit<Payload>>> {
    const response = await this.request<{ result: { points: Array<QdrantSearchHit<Payload>> } }>(
      `/collections/${collection}/points/query`,
      {
        method: 'POST',
        body: JSON.stringify({
          query: vector,
          limit: options.limit ?? 20,
          with_payload: true,
          with_vector: options.withVector ?? false,
          ...(options.exact == null ? {} : { params: { exact: options.exact } }),
          ...(options.filter ? { filter: options.filter } : {}),
          ...(options.scoreThreshold == null ? {} : { score_threshold: options.scoreThreshold }),
        }),
      },
    );
    return response.result.points;
  }

  async scroll<Payload>(
    collection: string,
    options: { limit?: number; offset?: string | number; withVector?: boolean; filter?: QdrantFilter } = {},
  ): Promise<{ points: Array<QdrantSearchHit<Payload>>; nextPageOffset?: string | number }> {
    const response = await this.request<{
      result: { points: Array<QdrantSearchHit<Payload>>; next_page_offset?: string | number };
    }>(`/collections/${collection}/points/scroll`, {
      method: 'POST',
      body: JSON.stringify({
        limit: options.limit ?? 1_000,
        ...(options.offset == null ? {} : { offset: options.offset }),
        with_payload: true,
        with_vector: options.withVector ?? false,
        ...(options.filter ? { filter: options.filter } : {}),
      }),
    });
    return { points: response.result.points, nextPageOffset: response.result.next_page_offset };
  }

  async updatePayloads<Payload>(
    collection: string,
    updates: Array<{ id: string; payload: Payload }>,
  ): Promise<void> {
    if (!updates.length) return;
    await this.request(`/collections/${collection}/points/batch?wait=true`, {
      method: 'POST',
      body: JSON.stringify({
        operations: updates.map(({ id, payload }) => ({
          set_payload: { payload, points: [uuid5ForId(id)] },
        })),
      }),
    });
  }

  async count(collection: string, filter?: QdrantFilter): Promise<number> {
    const response = await this.request<{ result: { count: number } }>(`/collections/${collection}/points/count`, {
      method: 'POST', body: JSON.stringify({ exact: true, ...(filter ? { filter } : {}) }),
    });
    return response.result.count;
  }

  async createSnapshot(collection: string): Promise<{ name: string }> {
    const response = await this.request<{ result: { name: string } }>(`/collections/${collection}/snapshots?wait=true`, {
      method: 'POST', body: '{}',
    });
    return response.result;
  }
}
