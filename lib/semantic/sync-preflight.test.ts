import { QdrantNotFoundError, QdrantUnavailableError, SemanticQdrant } from './qdrant';
import { assertSemanticTargetsReachable, SemanticSyncPreflightError } from './sync-preflight';

describe('assertSemanticTargetsReachable', () => {
  it('passes when Qdrant answers', async () => {
    await expect(assertSemanticTargetsReachable(async () => undefined)).resolves.toBeUndefined();
  });

  it('turns an unreachable Qdrant into a preflight error before any database work', async () => {
    const databaseRead = jest.fn();
    const run = async () => {
      await assertSemanticTargetsReachable(async () => { throw new QdrantUnavailableError('Unable to reach Qdrant'); });
      databaseRead();
    };
    await expect(run()).rejects.toBeInstanceOf(SemanticSyncPreflightError);
    await expect(run()).rejects.toThrow(/before any database read: Unable to reach Qdrant; watermark retained/);
    expect(databaseRead).not.toHaveBeenCalled();
  });

  it('does not hide unrelated failures', async () => {
    const other = new QdrantNotFoundError('missing collection');
    await expect(assertSemanticTargetsReachable(async () => { throw other; })).rejects.toBe(other);
  });
});

describe('SemanticQdrant.assertReachable', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('reports a refused connection as unavailable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;
    await expect(new SemanticQdrant({ url: 'http://localhost:6333' }).assertReachable())
      .rejects.toBeInstanceOf(QdrantUnavailableError);
  });

  it('reports a missing QDRANT_URL as unavailable without a network call', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const previous = process.env.QDRANT_URL;
    delete process.env.QDRANT_URL;
    try {
      await expect(new SemanticQdrant().assertReachable()).rejects.toBeInstanceOf(QdrantUnavailableError);
    } finally {
      if (previous !== undefined) process.env.QDRANT_URL = previous;
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses one cheap collections listing', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response(JSON.stringify({ result: { collections: [] } }), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    await new SemanticQdrant({ url: 'http://localhost:6333/' }).assertReachable();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:6333/collections');
  });
});
