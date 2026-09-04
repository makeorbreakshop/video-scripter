import { describe, expect, it } from 'vitest';
import { DAY_BUCKETS, HOUR_BUCKETS, type GlobalParams } from './core';
import { growthLog, logToRef, slide, fitPast30, blendScale, PAST30_AGES } from './growth';

// A params table shaped like a real fit: multipliers decreasing to 0 at day 30, a launch ladder
// above the day-1 value, a long tail above 1.
const P: GlobalParams = {
  mult: {
    [1 / 24]: 1.45, [2 / 24]: 1.35, [4 / 24]: 1.24, [8 / 24]: 1.10, [12 / 24]: 1.02, [18 / 24]: 0.95,
    1: 0.875, 2: 0.626, 3: 0.457, 5: 0.336, 7: 0.231, 14: 0.104, 21: 0.049, 30: 0,
  },
  qBins: {
    1: { edges: [-0.2, 0, 0.2, 0.4], resid: [-0.15, -0.05, 0, 0.05, 0.2] },
    3: { edges: [], resid: [] },
  },
  longtail: { ages: [60, 90, 180, 365, 730, 1500], mult: [1.12, 1.19, 1.34, 1.52, 1.74, 1.95], n: [900, 800, 700, 600, 400, 200] },
  fittedAt: '2026-09-04T00:00:00Z',
  nVideos: 5000,
};

const AGES = [1 / 48, 1 / 24, 2 / 24, 0.1, 0.25, 8 / 24, 0.5, 0.75, 0.99, 1, 1.01, 1.5, 2, 3, 5, 7, 14, 21, 29.9, 30, 30.1, 45, 60, 90, 200, 365, 900, 3000];

describe('logToRef', () => {
  it('is zero at day 30 and negative after it', () => {
    expect(logToRef(P, 30)).toBeCloseTo(0, 12);
    expect(logToRef(P, 90)).toBeLessThan(0);
    expect(logToRef(P, 3000)).toBeLessThan(logToRef(P, 90));
  });
  it('is strictly non-increasing in age across the whole domain', () => {
    for (let i = 1; i < AGES.length; i++) {
      expect(logToRef(P, AGES[i])).toBeLessThanOrEqual(logToRef(P, AGES[i - 1]) + 1e-12);
    }
  });
  it('reproduces the fitted bucket values exactly at the bucket ages', () => {
    for (const b of [...HOUR_BUCKETS, ...DAY_BUCKETS]) {
      expect(logToRef(P, b)).toBeCloseTo(P.mult[b]!, 12);
    }
  });
  it('is continuous across the day-1 seam -- the v3/v4 disagreement is gone', () => {
    const below = logToRef(P, 1 - 1e-6);
    const at = logToRef(P, 1);
    const above = logToRef(P, 1 + 1e-6);
    expect(Math.abs(below - at)).toBeLessThan(1e-5);
    expect(Math.abs(above - at)).toBeLessThan(1e-5);
    // and the sub-day branch really uses the ladder, not the day-1 clamp
    expect(logToRef(P, 0.5)).toBeGreaterThan(P.mult[1]! + 0.01);
  });
  it('is continuous across the day-30 seam', () => {
    expect(Math.abs(logToRef(P, 30 - 1e-6) - logToRef(P, 30 + 1e-6))).toBeLessThan(1e-5);
  });
  it('falls back to the day-1 clamp only when the ladder is unfitted', () => {
    const noLadder: GlobalParams = { ...P, mult: Object.fromEntries(Object.entries(P.mult).filter(([k]) => Number(k) >= 1)) };
    expect(logToRef(noLadder, 0.2)).toBe(noLadder.mult[1]);
  });
});

describe('growthLog', () => {
  it('is identity at fromAge == toAge', () => {
    for (const a of AGES) expect(growthLog(P, a, a)).toBe(0);
  });
  it('is monotone non-decreasing in toAge', () => {
    for (const from of [0.1, 1, 3, 30, 200]) {
      for (let i = 1; i < AGES.length; i++) {
        expect(growthLog(P, from, AGES[i])).toBeGreaterThanOrEqual(growthLog(P, from, AGES[i - 1]) - 1e-12);
      }
    }
  });
  it('is inverse-consistent: slide forward then back returns the input', () => {
    for (const from of AGES) for (const to of AGES) {
      expect(slide(P, slide(P, 1000, from, to), to, from)).toBeCloseTo(1000, 6);
      expect(growthLog(P, from, to) + growthLog(P, to, from)).toBeCloseTo(0, 12);
    }
  });
  it('runs from the first launch bucket to the last long-tail age without clamping in between', () => {
    expect(growthLog(P, 1 / 24, 1500)).toBeGreaterThan(growthLog(P, 1 / 24, 30));
    expect(growthLog(P, 1 / 24, 30)).toBeCloseTo(P.mult[1 / 24]!, 12);
  });
});

describe('channel blend and Q', () => {
  const ctx = { anchorAge: 1, chMultLogs: [1.2, 1.1, 1.3], q: 0.5, bucket: 1 };
  it('reproduces the v3 remaining growth exactly at anchor -> 30', () => {
    // v3: remaining = w*chm + (1-w)*g + qResidual, w = n/(n+k), k=2 at bucket 1
    const g = P.mult[1]!, chm = 1.2, w = 3 / (3 + 2), qr = 0.2;
    expect(growthLog(P, 1, 30, ctx)).toBeCloseTo(w * chm + (1 - w) * g + qr, 10);
  });
  it('keeps identity, monotonicity and antisymmetry under the blend', () => {
    expect(growthLog(P, 3, 3, ctx)).toBe(0);
    expect(growthLog(P, 1, 90, ctx)).toBeGreaterThan(growthLog(P, 1, 30, ctx));
    expect(growthLog(P, 1, 7, ctx) + growthLog(P, 7, 1, ctx)).toBeCloseTo(0, 12);
  });
  it('is a no-op with no priors and no Q', () => {
    expect(blendScale(P, { anchorAge: 1 }, () => 1)).toBeCloseTo(1, 12);
  });
  it('never inverts the curve, however extreme the channel', () => {
    const wild = { anchorAge: 1, chMultLogs: [-50, -50, -50, -50, -50, -50, -50, -50, -50, -50], q: null };
    expect(blendScale(P, wild, () => 1)).toBeGreaterThan(0);
    expect(growthLog(P, 1, 30, wild)).toBeGreaterThanOrEqual(0);
  });
  it('makes no channel claim at or past day 30', () => {
    expect(blendScale(P, { ...ctx, anchorAge: 30 }, () => 1)).toBe(1);
    expect(blendScale(P, { ...ctx, anchorAge: 400 }, () => 1)).toBe(1);
  });
});

describe('fitPast30', () => {
  const pairs = [
    ...Array.from({ length: 30 }, (_, i) => ({ laterAge: 70, v30: 1000, later: 1100 + i })),
    ...Array.from({ length: 30 }, (_, i) => ({ laterAge: 120, v30: 1000, later: 1250 + i })),
    ...Array.from({ length: 5 }, (_, i) => ({ laterAge: 400, v30: 1000, later: 900 + i })),
  ];
  it('medians each bucket and records real support', () => {
    const t = fitPast30(pairs);
    expect(t.ages).toEqual([...PAST30_AGES]);
    expect(t.n).toEqual([30, 30, 0, 5, 0]);
    expect(t.mult[0]).toBeCloseTo(1.1145, 3);
    expect(t.mult[1]).toBeCloseTo(1.2645, 3);
  });
  it('carries thin buckets forward and never goes below 1 or backwards', () => {
    const t = fitPast30(pairs);
    for (let i = 1; i < t.mult.length; i++) expect(t.mult[i]).toBeGreaterThanOrEqual(t.mult[i - 1]);
    expect(Math.min(...t.mult)).toBeGreaterThanOrEqual(1);
    expect(t.mult[3]).toBe(t.mult[2]); // the 5-pair 365 bucket is under minRows, carried forward
  });
});
