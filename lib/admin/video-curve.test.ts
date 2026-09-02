import {
  multAt, aleAt, expectedAt, expectedCurve, mergeActuals, packagingMarkers, ALE_BY_DAY,
} from './video-curve';

// The fitted global params (2026-09-02): median log(v30 / v_t) per day bucket.
const MULT = { 1: 0.8688779524, 2: 0.6064517819, 3: 0.4529065479, 5: 0.3022398317, 7: 0.2243642038, 14: 0.0957340325, 21: 0.0379776014, 30: 0 };

describe('multAt', () => {
  test('returns the fitted value exactly at a bucket', () => {
    for (const b of [1, 2, 3, 5, 7, 14, 21, 30]) expect(multAt(MULT, b)).toBeCloseTo(MULT[b as 1], 12);
  });
  test('interpolates between buckets in log(day+1) and stays monotone decreasing', () => {
    const m4 = multAt(MULT, 4);
    expect(m4).toBeLessThan(MULT[3]);
    expect(m4).toBeGreaterThan(MULT[5]);
    let prev = Infinity;
    for (let d = 0.1; d <= 30; d += 0.1) { const m = multAt(MULT, d); expect(m).toBeLessThanOrEqual(prev + 1e-12); prev = m; }
  });
  test('clamps below the first bucket and at/after day 30', () => {
    expect(multAt(MULT, 0)).toBeCloseTo(MULT[1], 12);
    expect(multAt(MULT, 0.5)).toBeCloseTo(MULT[1], 12);
    expect(multAt(MULT, 45)).toBe(0);
  });
  test('empty params mean no remaining growth', () => { expect(multAt({}, 3)).toBe(0); });
});

describe('aleAt', () => {
  test('uses the measured median absolute log error at the known days', () => {
    for (const [d, a] of ALE_BY_DAY) expect(aleAt(d)).toBeCloseTo(a, 12);
  });
  test('interpolates and flattens outside the measured range', () => {
    expect(aleAt(2)).toBeLessThan(0.26);
    expect(aleAt(2)).toBeGreaterThan(0.18);
    expect(aleAt(0.2)).toBeCloseTo(0.26, 12);
    expect(aleAt(60)).toBeCloseTo(0.05, 12);
  });
});

describe('expectedAt', () => {
  test('expected(day) = baseline * exp(-m(day)), so expected(30) = baseline', () => {
    expect(expectedAt(1000, MULT, 30).expected).toBeCloseTo(1000, 6);
    expect(expectedAt(1000, MULT, 1).expected).toBeCloseTo(1000 * Math.exp(-MULT[1]), 6);
  });
  test('the band is +/- the medALE on the log scale', () => {
    const p = expectedAt(1000, MULT, 7);
    expect(p.lo).toBeCloseTo(p.expected * Math.exp(-0.1), 6);
    expect(p.hi).toBeCloseTo(p.expected * Math.exp(0.1), 6);
    expect(p.lo).toBeLessThan(p.expected);
  });
  test('the curve rises with age', () => {
    expect(expectedAt(1000, MULT, 1).expected).toBeLessThan(expectedAt(1000, MULT, 7).expected);
  });
});

describe('expectedCurve', () => {
  test('spans day 0 to maxDay, ends at the baseline when maxDay is 30', () => {
    const c = expectedCurve(1000, MULT, 30);
    expect(c[0].day).toBe(0);
    expect(c[c.length - 1].day).toBe(30);
    expect(c[c.length - 1].expected).toBeCloseTo(1000, 6);
    expect(c.length).toBeGreaterThan(20);
  });
  test('is flat at the baseline past day 30', () => {
    const c = expectedCurve(1000, MULT, 60);
    const last = c[c.length - 1];
    expect(last.day).toBe(60);
    expect(last.expected).toBeCloseTo(1000, 6);
  });
  test('returns nothing without a baseline', () => {
    expect(expectedCurve(null, MULT, 30)).toEqual([]);
    expect(expectedCurve(0, MULT, 30)).toEqual([]);
  });
});

describe('mergeActuals', () => {
  const pub = '2026-08-01T12:00:00Z';
  test('merges samples and snapshots onto a days-since-publish axis, sorted', () => {
    const out = mergeActuals(
      pub,
      [{ at: '2026-08-03T12:00:00Z', views: 500 }],
      [{ at: '2026-08-01T18:00:00Z', views: 100 }, { at: '2026-08-02T00:00:00Z', views: 200 }]
    );
    expect(out.map((p) => p.day)).toEqual([0.25, 0.5, 2]);
    expect(out.map((p) => p.source)).toEqual(['sample', 'sample', 'snapshot']);
    expect(out[2].views).toBe(500);
  });
  test('drops points before publish, non-positive views, and exact duplicate days (snapshot wins)', () => {
    const out = mergeActuals(
      pub,
      [{ at: '2026-08-02T12:00:00Z', views: 300 }],
      [{ at: '2026-07-30T12:00:00Z', views: 10 }, { at: '2026-08-02T12:00:00Z', views: 299 }, { at: '2026-08-03T12:00:00Z', views: 0 }]
    );
    expect(out).toEqual([{ day: 1, views: 300, source: 'snapshot', at: '2026-08-02T12:00:00.000Z' }]);
  });
  test('handles empty input', () => { expect(mergeActuals(pub, [], [])).toEqual([]); });
});

describe('packagingMarkers', () => {
  const pub = '2026-08-01T00:00:00Z';
  test('marks thumbnail versions after the first with a before -> after pair', () => {
    const m = packagingMarkers(pub,
      [{ version: 1, first_seen: '2026-08-01T00:00:00Z' }, { version: 3, first_seen: '2026-08-06T00:00:00Z' }, { version: 2, first_seen: '2026-08-03T00:00:00Z' }],
      []);
    expect(m).toEqual([
      { kind: 'thumb', day: 2, at: '2026-08-03T00:00:00.000Z', version: 2, fromVersion: 1, from: null, to: null },
      { kind: 'thumb', day: 5, at: '2026-08-06T00:00:00.000Z', version: 3, fromVersion: 2, from: null, to: null },
    ]);
  });
  test('marks title changes with old -> new text and skips the original title', () => {
    const m = packagingMarkers(pub, [], [
      { version: 1, title: 'A', first_seen: '2026-08-01T00:00:00Z' },
      { version: 2, title: 'B', first_seen: '2026-08-04T12:00:00Z' },
    ]);
    expect(m).toEqual([{ kind: 'title', day: 3.5, at: '2026-08-04T12:00:00.000Z', version: 2, fromVersion: 1, from: 'A', to: 'B' }]);
  });
  test('marks a v2 whose v1 was never archived, inferring the previous version', () => {
    const m = packagingMarkers(pub, [{ version: 2, first_seen: '2026-08-05T00:00:00Z' }], []);
    expect(m).toEqual([{ kind: 'thumb', day: 4, at: '2026-08-05T00:00:00.000Z', version: 2, fromVersion: 1, from: null, to: null }]);
  });
  test('sorts thumbnail and title markers together by day and ignores pre-publish rows', () => {
    const m = packagingMarkers(pub,
      [{ version: 2, first_seen: '2026-08-05T00:00:00Z' }],
      [{ version: 1, title: 'A', first_seen: '2026-07-31T00:00:00Z' }, { version: 2, title: 'B', first_seen: '2026-08-02T00:00:00Z' }]);
    expect(m.map((x) => [x.kind, x.day])).toEqual([['title', 1], ['thumb', 4]]);
  });
});
