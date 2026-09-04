import { describe, expect, it } from 'vitest';
import type { GlobalParams } from './core';
import { channelCurve, contributionAt, sameAgeTolerance, scoreV5, project, type CurvePrior } from './curve';
import { growthLog } from './growth';

const P: GlobalParams = {
  mult: {
    [1 / 24]: 1.45, [2 / 24]: 1.35, [4 / 24]: 1.24, [8 / 24]: 1.10, [12 / 24]: 1.02, [18 / 24]: 0.95,
    1: 0.875, 2: 0.626, 3: 0.457, 5: 0.336, 7: 0.231, 14: 0.104, 21: 0.049, 30: 0,
  },
  qBins: {},
  longtail: { ages: [60, 90, 180, 365, 730, 1500], mult: [1.12, 1.19, 1.34, 1.52, 1.74, 1.95], n: [900, 800, 700, 600, 400, 200] },
  fittedAt: '2026-09-04T00:00:00Z', nVideos: 5000,
};

const prior = (ageDays: number, samples: [number, number][], lifetime?: [number, number]): CurvePrior => ({
  ageDays, samples: samples.map(([day, views]) => ({ day, views })),
  lifetime: lifetime ? { views: lifetime[0], ageDays: lifetime[1] } : null,
});

describe('sameAgeTolerance', () => {
  it('is a quarter of the age below one day and widens with the snapshot cadence', () => {
    expect(sameAgeTolerance(0.5)).toBeCloseTo(0.125, 6);
    expect(sameAgeTolerance(3)).toBe(1);
    expect(sameAgeTolerance(7)).toBe(2);
    expect(sameAgeTolerance(30)).toBe(3);
    expect(sameAgeTolerance(365)).toBeCloseTo(36.5, 6);
  });
});

describe('contributionAt -- the three branches', () => {
  it('real: a sample inside the tolerance is used untouched, distance 0', () => {
    const c = contributionAt(prior(10, [[1, 100], [3.4, 500], [7, 900]]), 3, P)!;
    expect(c.kind).toBe('real');
    expect(c.views).toBe(500);
    expect(c.fromAge).toBe(3.4);
    expect(c.logDistance).toBe(0);
  });
  it('real: picks the NEAREST in-tolerance sample when several qualify', () => {
    expect(contributionAt(prior(10, [[2.2, 400], [3.1, 500]]), 3, P)!.views).toBe(500);
  });
  it('interpolated: the nearest sample slid along G, with the distance recorded', () => {
    const c = contributionAt(prior(10, [[1, 100], [14, 900]]), 5, P)!;
    expect(c.kind).toBe('interpolated');
    expect(c.fromAge).toBe(14);   // nearer in LOG age than day 1 is
    expect(c.logDistance).toBeCloseTo(Math.abs(Math.log(14) - Math.log(5)), 10);
    // two samples => the prior's own Q corrects the slide, so assert the sign and the route
    expect(c.views).toBeLessThan(900);
    expect(c.views).toBeGreaterThan(100);
  });
  it('interpolated: a single sample slides on the pure global curve (no Q available)', () => {
    const c = contributionAt(prior(10, [[1, 100]]), 5, P)!;
    expect(c.kind).toBe('interpolated');
    expect(c.views).toBeCloseTo(100 * Math.exp(growthLog(P, 1, 5)), 8);
  });
  it('interpolated: works past day 30, down the long tail', () => {
    const c = contributionAt(prior(400, [[30, 1000]]), 365, P)!;
    expect(c.kind).toBe('interpolated');
    expect(c.views).toBeCloseTo(1000 * 1.52, 6);
  });
  it('lifetime: a prior with no samples slides its lifetime count BACK to the target age', () => {
    const c = contributionAt(prior(500, [], [15200, 400]), 3, P)!;
    expect(c.kind).toBe('lifetime');
    expect(c.fromAge).toBe(400);
    expect(c.views).toBeCloseTo(15200 * Math.exp(growthLog(P, 400, 3)), 8);
    expect(c.views).toBeLessThan(15200);   // sliding back down the curve
  });
  it('null when a prior has neither a usable sample nor a lifetime count', () => {
    expect(contributionAt(prior(10, []), 3, P)).toBeNull();
    expect(contributionAt(prior(10, [[1, 0]]), 3, P)).toBeNull();
  });
  it('prefers real over interpolated, and interpolated over lifetime', () => {
    const p = prior(10, [[3, 500], [1, 100]], [9000, 400]);
    expect(contributionAt(p, 3, P)!.kind).toBe('real');
    expect(contributionAt({ ...p, samples: [{ day: 1, views: 100 }] }, 3, P)!.kind).toBe('interpolated');
    expect(contributionAt({ ...p, samples: [] }, 3, P)!.kind).toBe('lifetime');
  });
});

describe('channelCurve', () => {
  const three = [prior(3, [[3, 900]]), prior(10, [[3, 1000]]), prior(20, [[3, 1100]])];
  it('is the time-weighted log median of the contributions, and reports n / neff / share', () => {
    const c = channelCurve(three, 3, P);
    expect(c.n).toBe(3);
    expect(c.measuredShare).toBe(1);
    expect(c.neff).toBeGreaterThan(2);
    expect(c.typical).not.toBeNull();
    // the newest prior carries the most weight, so C sits below the plain median of 1000
    expect(c.typical!).toBeLessThan(1000);
    expect(c.typical!).toBeGreaterThan(900);
  });
  it('reduces to the plain geometric median when every prior is the same age', () => {
    const same = [prior(5, [[3, 500]]), prior(5, [[3, 1000]]), prior(5, [[3, 2000]])];
    expect(channelCurve(same, 3, P).typical!).toBeCloseTo(1000, 6);
  });
  it('returns null below the >= 3 prior floor', () => {
    const c = channelCurve(three.slice(0, 2), 3, P);
    expect(c.typical).toBeNull();
    expect(c.n).toBe(2);
  });
  it('returns null below the neff >= 2 floor -- one fresh prior plus a stale tail is not a history', () => {
    const c = channelCurve([prior(0, [[3, 1000]]), prior(400, [[3, 1000]]), prior(500, [[3, 1000]])], 3, P);
    expect(c.n).toBe(3);
    expect(c.neff).toBeLessThan(2);
    expect(c.typical).toBeNull();
  });
  it('reports the measured share when the denominator is part modelled', () => {
    const c = channelCurve([prior(3, [[3, 900]]), prior(10, [[1, 400]]), prior(20, [], [9000, 300])], 3, P);
    expect(c.n).toBe(3);
    expect(c.measuredShare).toBeCloseTo(1 / 3, 10);
    expect(c.contributions.map((x) => x.kind)).toEqual(['real', 'interpolated', 'lifetime']);
    expect(c.typical).not.toBeNull();
  });
  it('fills a denominator where v4 had none: no prior has a real sample at t', () => {
    const c = channelCurve([prior(3, [[1, 400]]), prior(10, [[7, 2000]]), prior(20, [[1, 500]])], 3, P);
    expect(c.measuredShare).toBe(0);
    expect(c.typical).not.toBeNull();   // v4's same_age_ratio would be null here
  });
});

describe('scoreV5', () => {
  const priors = [prior(3, [[3, 900]]), prior(10, [[3, 1000]]), prior(20, [[3, 1100]])];
  it('score is v(t) / C(t) at true age, with no day-30 anchor in it', () => {
    const out = scoreV5({ vt: 2500, age: 3, snaps: [{ day: 1, views: 900 }, { day: 3, views: 2500 }], priors, params: P });
    expect(out.score!).toBeCloseTo(2500 / out.typicalAtAge!, 10);
    expect(out.ageDays).toBe(3);
    expect(out.confidence).toBe('likely');
  });
  it('insufficient, and a null score, when the curve has no denominator', () => {
    const out = scoreV5({ vt: 2500, age: 3, snaps: [{ day: 3, views: 2500 }], priors: priors.slice(0, 1), params: P });
    expect(out.score).toBeNull();
    expect(out.confidence).toBe('insufficient');
  });
  it('projection is a separate product and answers any horizon', () => {
    const base = { vt: 2500, age: 3, snaps: [{ day: 1, views: 900 }, { day: 3, views: 2500 }], priors, params: P };
    const p30 = scoreV5(base).projection;
    const p365 = scoreV5({ ...base, projectionHorizon: 365 }).projection;
    expect(p30).toBeGreaterThan(2500);
    expect(p365).toBeGreaterThan(p30);
    expect(scoreV5({ ...base, projectionHorizon: 3 }).projection).toBeCloseTo(2500, 6);
    // and the score does not move when the horizon does
    expect(scoreV5({ ...base, projectionHorizon: 365 }).score).toBe(scoreV5(base).score);
  });
  it('project() is the same curve, so it round-trips', () => {
    expect(project(P, project(P, 1000, 3, 90), 90, 3)).toBeCloseTo(1000, 6);
  });
});
