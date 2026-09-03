import {
  assertEmbeddingBudget,
  chunkEmbeddingInputs,
  embedTexts,
  embeddingCostUsd,
  estimateEmbeddingRun,
  normalizeQuery,
} from './embed';

describe('embedding client', () => {
  test('batches at no more than 256 inputs', () => {
    const batches = chunkEmbeddingInputs(Array.from({ length: 513 }, (_, i) => String(i)));
    expect(batches.map((batch) => batch.length)).toEqual([256, 256, 1]);
  });

  test('calculates text-embedding-3-small cost from input tokens', () => {
    expect(embeddingCostUsd(1_000_000)).toBeCloseTo(0.02);
    expect(embeddingCostUsd(250)).toBeCloseTo(0.000005);
  });

  test('normalizes query cache keys across casing and repeated whitespace', () => {
    expect(normalizeQuery('  Laser   ENGRAVER\nReviews ')).toBe('laser engraver reviews');
  });

  test('counts cl100k tokens locally and refuses runs above their cost ceiling', () => {
    const estimate = estimateEmbeddingRun(['hello', 'laser engraver']);
    expect(estimate).toEqual({ docs: 2, tokens: 5, est_usd: 0.0000001, usd_per_million_tokens: 0.02 });
    expect(() => assertEmbeddingBudget(estimate, 0.00000009)).toThrow(/exceeds --max-usd/);
    expect(() => assertEmbeddingBudget(estimate, 0.01)).not.toThrow();
  });

  test('retries 429 responses with backoff and logs each successful call cost', async () => {
    const create = jest.fn()
      .mockRejectedValueOnce(Object.assign(new Error('rate limited'), { status: 429 }))
      .mockResolvedValueOnce({
        data: [{ index: 0, embedding: [1, 2] }], usage: { prompt_tokens: 10, total_tokens: 10 },
      });
    const sleep = jest.fn(async () => undefined);
    const logCost = jest.fn(async () => undefined);

    await expect(embedTexts(['hello'], {
      dimensions: 2, client: { embeddings: { create } }, sleep, logCost, maxRetries: 2, requestGapMs: 0,
    })).resolves.toEqual([[1, 2]]);
    expect(create).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(500);
    expect(logCost).toHaveBeenCalledWith(10, 0.0000002);
  });
});
