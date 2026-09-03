import { chooseMedoids, recencyImportance } from './medoids';

describe('semantic channel medoids', () => {
  test('chooses representative medoids instead of averaging modes together', () => {
    const medoids = chooseMedoids([
      { id: 'a', vector: [1, 0], publishedAt: new Date('2026-09-01') },
      { id: 'b', vector: [0.9, 0.1], publishedAt: new Date('2026-08-30') },
      { id: 'c', vector: [0, 1], publishedAt: new Date('2026-09-01') },
    ], { maxMedoids: 2, similarityThreshold: 0.85, now: new Date('2026-09-03') });

    expect(medoids.map((m) => m.id).sort()).toEqual(['a', 'c']);
  });

  test('computes recency-weighted importance', () => {
    expect(recencyImportance(new Date('2026-09-01'), new Date('2026-09-03'), 0.01)).toBeCloseTo(Math.exp(-0.02));
  });
});
