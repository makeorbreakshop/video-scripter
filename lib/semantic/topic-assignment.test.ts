import { assignNearestCentroid, cosineSimilarity, parsePgVector } from './topic-assignment';

describe('semantic topic assignment helpers', () => {
  test('parses pgvector text', () => {
    expect(parsePgVector('[0.1, -0.2, 3]')).toEqual([0.1, -0.2, 3]);
  });

  test('computes cosine similarity with dimension guard', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(() => cosineSimilarity([1], [1, 2])).toThrow(/dimension/i);
  });

  test('assigns nearest centroid when it clears threshold', () => {
    const result = assignNearestCentroid([1, 0], [
      { cluster_id: 1, vector: [0, 1] },
      { cluster_id: 2, vector: [0.9, 0.1] },
    ], 0.5);

    expect(result).toEqual({ cluster_id: 2, cosine: expect.any(Number) });
    expect(assignNearestCentroid([1, 0], [{ cluster_id: 1, vector: [0, 1] }], 0.5)).toBeNull();
  });
});
