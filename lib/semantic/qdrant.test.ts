import {
  QdrantUnavailableError,
  reciprocalRankFuse,
  runWithLexicalFallback,
  semanticUnavailablePayload,
  uuid5ForId,
  SemanticQdrant,
} from './qdrant';

describe('Qdrant helpers', () => {
  test('maps raw ids to stable UUIDv5 point ids', () => {
    expect(uuid5ForId('MpGDoiSH_PQ')).toBe(uuid5ForId('MpGDoiSH_PQ'));
    expect(uuid5ForId('MpGDoiSH_PQ')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuid5ForId('other')).not.toBe(uuid5ForId('MpGDoiSH_PQ'));
  });

  test('fuses ranked lists with reciprocal rank fusion and reports provenance', () => {
    const result = reciprocalRankFuse(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      [{ id: 'b' }, { id: 'd' }, { id: 'a' }],
      (item) => item.id,
    );
    expect(result.map((item) => item.id)).toEqual(['b', 'a', 'd', 'c']);
    expect(result.find((item) => item.id === 'b')?.source).toBe('both');
    expect(result.find((item) => item.id === 'c')?.source).toBe('lexical');
    expect(result.find((item) => item.id === 'd')?.source).toBe('semantic');
    expect(result[0].rrfScore).toBeCloseTo(1 / 62 + 1 / 61);
  });

  test('falls back to lexical only for semantic availability failures', async () => {
    const lexical = jest.fn(async () => ['lexical']);
    await expect(runWithLexicalFallback(
      async () => { throw new QdrantUnavailableError('down'); }, lexical,
    )).resolves.toEqual({ value: ['lexical'], fellBack: true });
    expect(lexical).toHaveBeenCalledTimes(1);

    await expect(runWithLexicalFallback(
      async () => { throw new Error('programming bug'); }, lexical,
    )).rejects.toThrow('programming bug');
  });

  test('defines the semantic endpoint 503 contract', () => {
    expect(semanticUnavailablePayload()).toEqual({
      status: 503,
      body: { error: { code: 'semantic_unavailable', message: 'Semantic search is temporarily unavailable.' } },
    });
  });

  test('uses Qdrant universal Query API rather than the legacy search endpoint', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ result: { points: [] } }),
    }));
    const previousFetch = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      await new SemanticQdrant({ url: 'http://qdrant.test' }).query('channels_v1', [0.1, 0.2], { limit: 5 });
      const [requestUrl, requestInit] = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0];
      expect(requestUrl).toBe('http://qdrant.test/collections/channels_v1/points/query');
      expect(JSON.parse(String(requestInit.body))).toMatchObject({ query: [0.1, 0.2], limit: 5 });
    } finally {
      global.fetch = previousFetch;
    }
  });
});
