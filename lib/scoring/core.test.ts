import { bucketFor, growthExponent, median, scoreVideo, fitParams, qResidual, GlobalParams } from './core';

const params: GlobalParams = {
  mult: { 1: Math.log(2.2), 2: Math.log(1.9), 3: Math.log(1.4), 5: Math.log(1.25), 7: Math.log(1.12), 14: Math.log(1.05), 21: Math.log(1.02), 30: 0 },
  qBins: { 3: { edges: [0.2, 0.4, 0.6, 0.8], resid: [-0.2, -0.1, 0, 0.1, 0.25] } },
  fittedAt: '2026-09-02T00:00:00Z',
  nVideos: 1000,
};

describe('bucketFor', () => {
  test('snaps to the nearest schedule day', () => {
    expect(bucketFor(0.6)).toBe(1);
    expect(bucketFor(4)).toBe(3);
    expect(bucketFor(6)).toBe(5);
    expect(bucketFor(11)).toBe(14);
    expect(bucketFor(40)).toBe(30);
  });
});

describe('growthExponent', () => {
  test('power-law exponent from first and latest snapshot', () => {
    // views 100 at day 0, 400 at day 3 -> log(4)/log(4) = 1
    expect(growthExponent([{ day: 0, views: 100 }, { day: 3, views: 400 }])).toBeCloseTo(1, 6);
  });
  test('null with fewer than two usable points', () => {
    expect(growthExponent([{ day: 1, views: 50 }])).toBeNull();
    expect(growthExponent([{ day: 1, views: 0 }, { day: 2, views: 10 }])).toBeNull();
  });
});

describe('qResidual', () => {
  test('bins by Q with monotone residuals and falls back to 0 without a table', () => {
    expect(qResidual(params, 3, 0.1)).toBe(-0.2);
    expect(qResidual(params, 3, 0.5)).toBe(0);
    expect(qResidual(params, 3, 5)).toBe(0.25);
    expect(qResidual(params, 3, null)).toBe(0);
    expect(qResidual(params, 7, 0.5)).toBe(0);
  });
});

describe('scoreVideo', () => {
  const base = {
    vt: 1000, day: 3,
    snaps: [{ day: 1, views: 500 }, { day: 3, views: 1000 }],
    priorV30: [900, 1000, 1100, 1200, 800],
    priorSameAge: [400, 500, 600, 450, 550],
    params,
  };

  test('with no channel growth history it projects with the global multiplier plus the Q correction', () => {
    const out = scoreVideo({ ...base, priorMultLogs: [] });
    const q = growthExponent(base.snaps)!;                 // log(2)/log(2) = 1 -> top bin (+0.25)
    expect(out.est30).toBeCloseTo(1000 * Math.exp(Math.log(1.4) + 0.25), 6);
    expect(out.baseline).toBe(1000);
    expect(out.score).toBeCloseTo(out.est30 / 1000, 6);
    expect(out.sameAgeRatio).toBeCloseTo(1000 / 500, 6);
    expect(out.confidence).toBe('likely');
    expect(out.q).toBeCloseTo(q, 6);
  });

  test('channel growth history is shrunk in by n/(n+k)', () => {
    const chLogs = [Math.log(1.8), Math.log(1.8), Math.log(1.8)]; // channel grows 1.8x from day 3, n=3, k=1 -> w=.75
    const out = scoreVideo({ ...base, priorMultLogs: chLogs });
    const remaining = 0.75 * Math.log(1.8) + 0.25 * Math.log(1.4) + 0.25;
    expect(out.est30).toBeCloseTo(1000 * Math.exp(remaining), 6);
  });

  test('confidence follows age and history', () => {
    expect(scoreVideo({ ...base, day: 1, priorMultLogs: [] }).confidence).toBe('early');
    expect(scoreVideo({ ...base, day: 9, priorMultLogs: [] }).confidence).toBe('confirmed');
    expect(scoreVideo({ ...base, priorMultLogs: [], priorV30: [1, 2], priorSameAge: [] }).confidence).toBe('insufficient');
  });

  test('at day 30+ the estimate is the observed count', () => {
    const out = scoreVideo({ ...base, day: 35, vt: 5000, priorMultLogs: [] });
    expect(out.est30).toBe(5000);
  });
});

describe('fitParams', () => {
  test('fits per-bucket medians and monotone Q bins from rows', () => {
    const rows = [];
    for (let i = 0; i < 200; i++) {
      const q = i / 200;                                   // spread Q 0..1
      const growth = 1.2 + q;                              // more growth for higher Q
      rows.push({ bucket: 3, vt: 100, v30: 100 * growth, q });
    }
    const p = fitParams(rows, '2026-09-02T00:00:00Z');
    expect(p.mult[3]).toBeCloseTo(Math.log(1.2 + 0.4975), 1);
    const bins = p.qBins[3];
    expect(bins.edges).toHaveLength(4);
    for (let i = 1; i < bins.resid.length; i++) expect(bins.resid[i]).toBeGreaterThanOrEqual(bins.resid[i - 1]);
    expect(bins.resid[0]).toBeLessThan(0);
    expect(bins.resid[4]).toBeGreaterThan(0);
    expect(p.qBins[7]).toEqual({ edges: [], resid: [] });   // too few rows -> no correction
  });

  test('median handles even and odd lengths', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
