import { medALE, bias, spearman, prf, ranks, distanceBucket, ageBucket } from './v5-metrics';

describe('v5 metrics', () => {
  it('medALE and bias are the median absolute / signed log error', () => {
    expect(medALE([[2, 1], [1, 2], [1, 1]])!).toBeCloseTo(Math.log(2), 10);
    expect(bias([[2, 1], [2, 1], [1, 1]])!).toBeCloseTo(Math.log(2), 10);
    expect(bias([[1, 2], [1, 2], [1, 1]])!).toBeCloseTo(-Math.log(2), 10);
  });
  it('drops non-positive pairs and returns null when nothing is usable', () => {
    expect(medALE([[0, 1], [1, 0]])).toBeNull();
  });
  it('spearman is 1 on a monotone pair set and -1 on a reversed one', () => {
    expect(spearman([[1, 10], [2, 20], [3, 30], [4, 40]])!).toBeCloseTo(1, 10);
    expect(spearman([[1, 40], [2, 30], [3, 20], [4, 10]])!).toBeCloseTo(-1, 10);
    expect(spearman([[1, 1], [2, 2]])).toBeNull();
  });
  it('ranks average ties', () => { expect(ranks([5, 5, 1])).toEqual([2.5, 2.5, 1]); });
  it('prf counts outlier calls at the threshold', () => {
    const r = prf([[3, 3], [3, 1], [1, 3], [1, 1]]);
    expect([r.tp, r.fp, r.fn]).toEqual([1, 1, 1]);
    expect(r.f1!).toBeCloseTo(0.5, 10);
  });
  it('labels distance and age buckets', () => {
    expect(distanceBucket(0)).toBe('0 (measured)');
    expect(distanceBucket(0.3)).toBe('<=0.35 (~1 bucket)');
    expect(ageBucket(0.02)).toBe('<1h');
    expect(ageBucket(3)).toBe('3d-7d');
    expect(ageBucket(2000)).toBe('>=1500d');
  });
});
