import {
  QdrantUnavailableError,
  reciprocalRankFuse,
  reciprocalRankFuseMany,
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

  test('fuses any number of ranked lists for multi-query retrieval', () => {
    const result = reciprocalRankFuseMany(
      [
        [{ id: 'a' }, { id: 'b' }],
        [{ id: 'b' }, { id: 'c' }],
        [{ id: 'c' }, { id: 'b' }],
      ],
      (item) => item.id,
    );
    expect(result.map((item) => item.id)).toEqual(['b', 'c', 'a']);
    expect(result[0].rrfScore).toBeCloseTo(1 / 62 + 1 / 61 + 1 / 62);
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
      await new SemanticQdrant({ url: 'http://qdrant.test' }).query(
        'channels_v1',
        [0.1, 0.2],
        { limit: 5, exact: true },
      );
      const [requestUrl, requestInit] = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0];
      expect(requestUrl).toBe('http://qdrant.test/collections/channels_v1/points/query');
      expect(JSON.parse(String(requestInit.body))).toMatchObject({
        query: [0.1, 0.2],
        limit: 5,
        params: { exact: true },
      });
    } finally {
      global.fetch = previousFetch;
    }
  });

  test('scrolls collection points with vectors for offline representation builds', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ result: { points: [{ id: 'one', payload: { channel_id: 'c' }, vector: [0.1] }], next_page_offset: 'next' } }),
    }));
    const previousFetch = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      await expect(new SemanticQdrant({ url: 'http://qdrant.test' }).scroll('videos_v1', {
        limit: 1000, offset: 'cursor', withVector: true,
      })).resolves.toEqual({
        points: [{ id: 'one', payload: { channel_id: 'c' }, vector: [0.1] }],
        nextPageOffset: 'next',
      });
      const [, requestInit] = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0];
      expect(JSON.parse(String(requestInit.body))).toEqual({
        limit: 1000, offset: 'cursor', with_payload: true, with_vector: true,
      });
    } finally {
      global.fetch = previousFetch;
    }
  });

  test('retrieves a bounded id batch with vectors for offline reranking', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ result: [{ id: 'one', payload: { video_id: 'a' }, vector: [0.1] }] }),
    }));
    const previousFetch = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      await expect(new SemanticQdrant({ url: 'http://qdrant.test' }).points('videos_v1', ['a', 'b'], {
        withVector: true,
      })).resolves.toEqual([{ id: 'one', payload: { video_id: 'a' }, vector: [0.1] }]);
      const [requestUrl, requestInit] = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0];
      expect(requestUrl).toBe('http://qdrant.test/collections/videos_v1/points');
      expect(JSON.parse(String(requestInit.body))).toEqual({
        ids: [uuid5ForId('a'), uuid5ForId('b')], with_payload: true, with_vector: true,
      });
    } finally {
      global.fetch = previousFetch;
    }
  });

  test('surfaces bounded Qdrant validation details for failed writes', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => '{"status":{"error":"Wrong input: payload too large"}}',
    }));
    const previousFetch = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      await expect(new SemanticQdrant({ url: 'http://qdrant.test' }).upsert('videos', [{
        id: uuid5ForId('bad'), vector: [0.1], payload: { id: 'bad' },
      }])).rejects.toThrow(/HTTP 400.*Wrong input: payload too large/i);
    } finally {
      global.fetch = previousFetch;
    }
  });
});
