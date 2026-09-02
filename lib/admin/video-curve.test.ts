import {
  multAt, aleAt, expectedAt, expectedCurve, projectedCurve, curveDays, mergeActuals, packagingMarkers, ALE_BY_DAY,, expectedAtAge } from './video-curve';

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
    for (let d = 0.01; d <= 30; d += 0.01) { const m = multAt(MULT, d); expect(m).toBeLessThanOrEqual(prev + 1e-12); prev = m; }
  });
  test('extrapolates below day 1 along the d1 -> d2 slope, so the launch hours are not flat', () => {
    const x = (d: number) => Math.log(d + 1);
    const slope = (MULT[2] - MULT[1]) / (x(2) - x(1));
    expect(multAt(MULT, 0.5)).toBeCloseTo(MULT[1] + slope * (x(0.5) - x(1)), 12);
    expect(multAt(MULT, 0.5)).toBeGreaterThan(MULT[1]);
    expect(multAt(MULT, 1 / 24)).toBeGreaterThan(multAt(MULT, 0.5));
  });
  test('clamps at/after day 30', () => {
    expect(multAt(MULT, 45)).toBe(0);
  });
  test('falls back to the flat clamp when there is only one bucket to work from', () => {
    expect(multAt({ 1: 0.9 }, 0.2)).toBeCloseTo(0.9, 12);
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
  test('rises through the launch hours instead of sitting flat below day 1', () => {
    const h1 = expectedAt(1000, MULT, 1 / 24).expected;
    const h12 = expectedAt(1000, MULT, 0.5).expected;
    const d1 = expectedAt(1000, MULT, 1).expected;
    expect(h1).toBeGreaterThan(0);
    expect(h1).toBeLessThan(h12);
    expect(h12).toBeLessThan(d1);
  });
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

describe('curveDays', () => {
  test('starts at minDay, ends at maxDay and is strictly increasing', () => {
    const d = curveDays(30, 60, 1 / 24);
    expect(d[0]).toBe(1 / 24);
    expect(d[d.length - 1]).toBe(30);
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThan(d[i - 1]);
  });
  test('defaults to starting at day 0', () => {
    const d = curveDays(30);
    expect(d[0]).toBe(0);
    expect(d[d.length - 1]).toBe(30);
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThan(d[i - 1]);
  });
  test('is denser early than late, so the launch window is readable', () => {
    const d = curveDays(30);
    const early = d.filter((x) => x <= 3).length;
    const late = d.filter((x) => x > 15).length;
    expect(early).toBeGreaterThan(late);
  });
});

describe('curve starts', () => {
  test('both curves honour a minDay so they begin at the first actual point', () => {
    const b = expectedCurve(1000, MULT, 3, 60, 1 / 48);
    const p = projectedCurve(1800, MULT, 3, 60, 1 / 48);
    expect(b[0].day).toBe(1 / 48);
    expect(p[0].day).toBe(1 / 48);
    expect(b[b.length - 1].day).toBe(3);
  });
});

describe('projectedCurve', () => {
  test('has the baseline shape and lands on est30 at day 30', () => {
    const c = projectedCurve(2000, MULT, 30);
    expect(c[c.length - 1].day).toBe(30);
    expect(c[c.length - 1].projected).toBeCloseTo(2000, 6);
    expect(c[0].day).toBe(0);
    expect(c[0].projected).toBeLessThan(2000 * Math.exp(-MULT[1])); // day 0 sits below the d1 value
  });
  test('is the baseline curve scaled by the score, so the gap at any day is the score', () => {
    const base = expectedCurve(1000, MULT, 30);
    const proj = projectedCurve(1800, MULT, 30);
    expect(proj).toHaveLength(base.length);
    for (let i = 0; i < base.length; i++) {
      expect(proj[i].day).toBe(base[i].day);
      expect(proj[i].projected / base[i].expected).toBeCloseTo(1.8, 9);
    }
  });
  test('stays flat at est30 past day 30', () => {
    const c = projectedCurve(2000, MULT, 60);
    expect(c[c.length - 1].projected).toBeCloseTo(2000, 6);
  });
  test('returns nothing without an est30', () => {
    expect(projectedCurve(null, MULT, 30)).toEqual([]);
    expect(projectedCurve(0, MULT, 30)).toEqual([]);
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

describe('expectedAtAge', () => {
  const mult = { 1: 0.87, 2: 0.61, 3: 0.45, 5: 0.30, 7: 0.22, 14: 0.096, 21: 0.038, 30: 0 } as any;
  it('is the baseline at and after day 30', () => {
    expect(expectedAtAge(1000, mult, 30)).toBeCloseTo(1000, 6);
    expect(expectedAtAge(1000, mult, 68)).toBeCloseTo(1000, 6);
  });
  it('is below the baseline early on and null without a baseline', () => {
    expect(expectedAtAge(1000, mult, 1)!).toBeLessThan(500);
    expect(expectedAtAge(null, mult, 1)).toBeNull();
  });
});
