import { mrr, ndcgAt, percentile, recallAt } from './eval';

describe('semantic eval metrics', () => {
  const grades = new Map([['a', 2], ['b', 1], ['c', 1]]);

  test('computes recall at k against positive judgments', () => {
    expect(recallAt(['x', 'a', 'b'], grades, 3)).toBeCloseTo(2 / 3);
  });

  test('computes reciprocal rank of the first positive result', () => {
    expect(mrr(['x', 'a', 'b'], grades)).toBe(0.5);
    expect(mrr(['x'], grades)).toBe(0);
  });

  test('computes graded NDCG and gives a perfect ordering 1.0', () => {
    expect(ndcgAt(['a', 'b', 'c'], grades, 3)).toBeCloseTo(1);
    expect(ndcgAt(['b', 'x', 'a'], grades, 3)).toBeGreaterThan(0);
    expect(ndcgAt(['b', 'x', 'a'], grades, 3)).toBeLessThan(1);
  });

  test('uses nearest-rank percentiles for latency reporting', () => {
    expect(percentile([10, 20, 30, 40], 0.95)).toBe(40);
    expect(percentile([], 0.95)).toBeNull();
  });
});
