import { dbsfFuse, linearFuse, weightedReciprocalRankFuse } from './fusion-v2';

describe('semantic v2 fusion', () => {
  const lexical = [
    { id: 'a', score: 0.9 },
    { id: 'b', score: 0.4 },
  ];
  const dense = [
    { id: 'c', score: 0.8 },
    { id: 'a', score: 0.7 },
  ];

  test('weighted RRF lets lane configs emphasize exact lexical matches', () => {
    const fused = weightedReciprocalRankFuse([
      { source: 'lexical', weight: 3, items: lexical },
      { source: 'dense', weight: 1, items: dense },
    ]);

    expect(fused[0].id).toBe('a');
    expect(fused[0].sources).toEqual(['dense', 'lexical']);
    expect(fused[0].ranks.lexical).toBe(1);
  });

  test('DBSF normalizes per-source score distributions before summing', () => {
    const fused = dbsfFuse([
      { source: 'lexical', weight: 1, items: lexical },
      { source: 'dense', weight: 1, items: dense },
    ]);

    expect(fused.map((item) => item.id)).toContain('a');
    expect(fused[0].score).toBeGreaterThan(0);
  });

  test('linear fusion min-max normalizes and preserves source metadata', () => {
    const fused = linearFuse([
      { source: 'lexical', weight: 0.7, items: lexical },
      { source: 'dense', weight: 0.3, items: dense },
    ]);

    expect(fused[0].id).toBe('a');
    expect(fused[0].rawScores.lexical).toBe(0.9);
  });
});
