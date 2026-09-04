import {
  multAt, aleAt, expectedAt, expectedCurve, projectedCurve, curveDays, mergeActuals, packagingMarkers, ALE_BY_DAY, expectedAtAge, longtailAt, fitScale, forecastCurve } from './video-curve';

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
  test('drops pre-publish points; keeps zero and gives timed samples precedence', () => {
    const out = mergeActuals(
      pub,
      [{ at: '2026-08-02T12:00:00Z', views: 300 }],
      [{ at: '2026-07-30T12:00:00Z', views: 10 }, { at: '2026-08-02T12:00:00Z', views: 299 }, { at: '2026-08-03T12:00:00Z', views: 0 }]
    );
    expect(out).toEqual([{ day: 1, views: 299, source: 'sample', at: '2026-08-02T12:00:00.000Z' }, { day: 2, views: 0, source: 'sample', at: '2026-08-03T12:00:00.000Z' }]);
  });
  test('handles empty input', () => { expect(mergeActuals(pub, [], [])).toEqual([]); });
});


describe('mergeActuals shared RSS observation contract', () => {
  const pub = '2026-08-01T12:00:00Z';

  test('an rss reading fills a day with no paid reading at all', () => {
    const out = mergeActuals(pub, [], [], [{ at: '2026-08-06T12:00:00Z', views: 900 }]);
    expect(out).toEqual([{ day: 5, views: 900, source: 'rss', at: '2026-08-06T12:00:00.000Z' }]);
  });

  test('real RSS evidence supersedes the synthetic daily anchor', () => {
    const out = mergeActuals(pub,
      [{ at: '2026-08-06T12:00:00Z', views: 1000 }],
      [],
      [{ at: '2026-08-06T20:00:00Z', views: 1010 }]);
    expect(out.map((p) => p.source)).toEqual(['rss']);
    expect(out[0].views).toBe(1010);
  });

  test('a neighboring paid sample does not erase RSS evidence', () => {
    const out = mergeActuals(pub,
      [],
      [{ at: '2026-08-06T12:00:00Z', views: 1000 }],
      [{ at: '2026-08-06T18:00:00Z', views: 1010 }]);
    expect(out.map((p) => p.source)).toEqual(['sample', 'rss']);
  });

  test('an rss reading more than 12h from any paid reading survives', () => {
    const out = mergeActuals(pub,
      [{ at: '2026-08-06T12:00:00Z', views: 1000 }],
      [],
      [{ at: '2026-08-08T12:00:00Z', views: 1400 }]);
    expect(out.map((p) => [p.source, p.views])).toEqual([['snapshot', 1000], ['rss', 1400]]);
  });

  test('on the exact same instant the stronger source wins, in either input order', () => {
    const at = '2026-08-06T12:00:00Z';
    expect(mergeActuals(pub, [{ at, views: 1 }], [{ at, views: 2 }], [{ at, views: 3 }])[0])
      .toMatchObject({ source: 'sample', views: 2 });
    expect(mergeActuals(pub, [], [{ at, views: 2 }], [{ at, views: 3 }])[0])
      .toMatchObject({ source: 'sample', views: 2 });
  });

  test('rss is optional, so every existing caller keeps its two-source behaviour', () => {
    const out = mergeActuals(pub, [{ at: '2026-08-03T12:00:00Z', views: 500 }], []);
    expect(out.map((p) => p.source)).toEqual(['snapshot']);
  });

  test('rss retains both endpoints of a flat interval', () => {
    const out = mergeActuals(pub, [], [], [
      { at: '2026-08-06T00:00:00Z', views: 900 },
      { at: '2026-08-06T12:00:00Z', views: 900 },
      { at: '2026-08-10T00:00:00Z', views: 1200 },
    ]);
    expect(out.map((p) => p.views)).toEqual([900, 900, 1200]);
  });
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
  it('is the baseline at day 30 and keeps rising after it with the long tail', () => {
    expect(expectedAtAge(1000, mult, 30)).toBeCloseTo(1000, 6);
    expect(expectedAtAge(1000, mult, 68, LT)).toBeGreaterThan(1000);
    expect(expectedAtAge(1000, mult, 68, LT)).toBeLessThan(1130);
    expect(expectedAtAge(1000, mult, 365, LT)).toBeCloseTo(1300, 0);
  });
  it('is flat at the baseline past day 30 when no long tail was fitted', () => {
    expect(expectedAtAge(1000, mult, 68)).toBeCloseTo(1000, 6);
  });
  it('is below the baseline early on and null without a baseline', () => {
    expect(expectedAtAge(1000, mult, 1)!).toBeLessThan(500);
    expect(expectedAtAge(null, mult, 1)).toBeNull();
  });
});


const LT = { ages: [60, 90, 180, 365, 730, 1500], mult: [1.086, 1.121, 1.121, 1.3, 1.3, 1.3] };

describe('longtailAt', () => {
  it('is 1 up to day 30 and at the first fitted age matches the fit', () => {
    expect(longtailAt(LT, 10)).toBe(1);
    expect(longtailAt(LT, 30)).toBe(1);
    expect(longtailAt(LT, 60)).toBeCloseTo(1.086, 6);
  });
  it('interpolates in log(day) between fitted ages and is monotonic', () => {
    const v = longtailAt(LT, 45);
    expect(v).toBeGreaterThan(1);
    expect(v).toBeLessThan(1.086);
    expect(longtailAt(LT, 200)).toBeGreaterThan(longtailAt(LT, 90));
  });
  it('is flat past the last fitted age and 1 when no long tail exists', () => {
    expect(longtailAt(LT, 5000)).toBeCloseTo(1.3, 6);
    expect(longtailAt(null, 400)).toBe(1);
  });
});

describe('curves past day 30', () => {
  const mult = { 1: 0.87, 14: 0.096, 30: 0 } as any;
  it('draws the typical curve out to the video age instead of stopping flat', () => {
    const c = expectedCurve(1000, mult, 120, 40, 0, LT);
    const last = c[c.length - 1];
    expect(last.day).toBeCloseTo(120, 6);
    expect(last.expected).toBeGreaterThan(1000);
    expect(last.hi).toBeGreaterThan(last.expected);
  });
  it('scales the implied path by the same long tail so the ratio stays the score', () => {
    const e = expectedCurve(1000, mult, 120, 40, 0, LT);
    const p = projectedCurve(3000, mult, 120, 40, 0, LT);
    const i = p.length - 1;
    expect(p[i].projected / e[i].expected).toBeCloseTo(3, 6);
  });
});

describe('mergeActuals dedupe and fitScale', () => {
  const pub = '2026-08-29T16:00:00Z';
  it('keeps a sample whose identical snapshot was already dropped', () => {
    const out = mergeActuals(pub,
      [{ at: '2026-09-01T12:00:00Z', views: 816558 }, { at: '2026-09-02T12:00:00Z', views: 884332 }],
      [{ at: '2026-09-01T18:00:00Z', views: 816558 }]);
    expect(out.map((a) => [a.source, a.views])).toEqual([['sample', 816558], ['snapshot', 884332]]);
  });
  it('drops a snapshot next to a sample and a repeated identical count', () => {
    const out = mergeActuals(pub,
      [{ at: '2026-09-01T12:00:00Z', views: 817000 }, { at: '2026-09-02T12:00:00Z', views: 817000 }],
      [{ at: '2026-09-02T18:30:00Z', views: 884000 }]);
    expect(out.map((a) => a.views)).toEqual([817000, 884000]);
  });
  it('fits the typical curve through the points', () => {
    const mult = { 1: 0.87, 2: 0.61, 3: 0.45, 5: 0.30, 7: 0.22, 14: 0.096, 21: 0.038, 30: 0 } as any;
    const pts = [1, 3, 5].map((day) => ({ day, views: 2 * expectedAt(1000, mult, day).expected }));
    expect(fitScale(pts, 1000, mult)!).toBeCloseTo(2, 6);
    expect(fitScale([], 1000, mult)).toBeNull();
  });
});

describe('forecastCurve', () => {
  const mult = { 1: Math.log(2.27), 3: Math.log(1.52), 7: Math.log(1.22), 14: Math.log(1.09), 30: 0 };
  it('starts at the current measurement and lands on est30 at day 30', () => {
    const pts = forecastCurve(950_000, 0.75, 2_300_000, mult, 30, 60, null);
    expect(pts[0].day).toBeCloseTo(0.75);
    expect(pts[0].projected).toBeCloseTo(950_000);
    const end = pts[pts.length - 1];
    expect(end.day).toBeCloseTo(30);
    expect(end.projected).toBeCloseTo(2_300_000, -2);
    for (let i = 1; i < pts.length; i++) expect(pts[i].projected).toBeGreaterThanOrEqual(pts[i - 1].projected - 1e-6);
  });
  it('never dips below the current measurement even when est30 is lower', () => {
    const pts = forecastCurve(500_000, 2, 400_000, mult, 30, 40, null);
    expect(pts[0].projected).toBeCloseTo(500_000);
    expect(pts[pts.length - 1].projected).toBeCloseTo(400_000, -2);
  });
});
