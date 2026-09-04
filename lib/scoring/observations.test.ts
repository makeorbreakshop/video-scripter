import { mergeObservations } from './observations';
const pub = '2026-08-01T00:00:00Z';
const p = (hour: number, views: number) => ({ at: new Date(Date.parse(pub) + hour * 3600000), views });
describe('shared RSS scoring observations', () => {
  test('RSS is retained beside paid evidence and wins over a synthetic daily point', () => {
    const out = mergeObservations(pub, [p(12, 90)], [p(2, 20)], [p(2.25, 30)]);
    expect(out.map(x => [x.views, x.source])).toEqual([[20, 'sample'], [30, 'rss']]);
  });
  test('exact timestamp conflicts prefer API, even over a daily snapshot', () => {
    expect(mergeObservations(pub, [p(2, 100)], [p(2, 20)], [p(2, 30)]).map(x => x.views)).toEqual([20]);
  });
  test('preserves plateau endpoints, latest age and legitimate decreases', () => {
    const out = mergeObservations(pub, [], [], [p(1, 10), p(2, 10), p(3, 10), p(4, 9)]);
    expect(out.map(x => [x.day * 24, x.views])).toEqual([[1, 10], [3, 10], [4, 9]]);
  });
  test('rejects invalid/future/prepublication data and retains zero observations', () => {
    const out = mergeObservations(pub, [], [p(-1, 1), p(0, 0), p(1, -2), p(2, Infinity), p(3, 1)], [], Date.parse(pub) + 2 * 3600000);
    expect(out.map(x => x.views)).toEqual([0]);
  });
});

import { scoreV5 } from './curve';
import type { GlobalParams } from './core';
test('RSS-only observations feed both the score numerator and channel priors', () => {
  const params: GlobalParams = { mult: { 1: 1, 2: 0.5, 30: 0 }, qBins: {}, fittedAt: pub, nVideos: 100 };
  const priors = Array.from({ length: 10 }, (_, i) => ({ ageDays: i * 3 + 3, samples: mergeObservations(pub, [], [], [p(24, 100), p(48, 200)]) }));
  const first = mergeObservations(pub, [], [], [p(24, 200)]);
  const later = mergeObservations(pub, [], [], [p(24, 200), p(48, 600)]);
  const score = (snaps: typeof first) => scoreV5({ vt: snaps.at(-1)!.views, age: snaps.at(-1)!.day, snaps, priors, params });
  expect(score(first).score).toBeCloseTo(2);
  expect(score(later).score).toBeCloseTo(3);
  expect(score(later).ageDays).toBe(2);
});
