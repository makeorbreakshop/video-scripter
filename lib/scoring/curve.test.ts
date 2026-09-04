import { growthExponent, type GlobalParams } from './core';
import { channelCurve, contributionAt, sameAgeTolerance, scoreV5, project, type CurvePrior } from './curve';
import { growthLog, logToRef } from './growth';

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
    // sliding BACKWARD from the anchor: the global curve only, no per-prior blend (2026-09-04)
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
  it('projection is a separate product, and the shipped horizon is capped at 30', () => {
    const base = { vt: 2500, age: 3, snaps: [{ day: 1, views: 900 }, { day: 3, views: 2500 }], priors, params: P };
    const p30 = scoreV5(base).projection;
    expect(p30).toBeGreaterThan(2500);
    expect(scoreV5({ ...base, projectionHorizon: 7 }).projection).toBeLessThan(p30);
    expect(scoreV5({ ...base, projectionHorizon: 3 }).projection).toBeCloseTo(2500, 6);
    // 90/365 are measured (verification part 4) but not shipped: growth.LONG_HORIZONS_ENABLED
    // is off, so a 365 request comes back as the 30-day answer, labelled 30.
    const long = scoreV5({ ...base, projectionHorizon: 365 });
    expect(long.projectionHorizon).toBe(30);
    expect(long.projection).toBeCloseTo(p30, 9);
    // and the score does not move when the horizon does
    expect(long.score).toBe(scoreV5(base).score);
  });
  it('project() still answers any horizon -- the cap is on the product, not the math', () => {
    expect(project(P, 2500, 3, 365)).toBeGreaterThan(project(P, 2500, 3, 30));
  });
  it('project() is the same curve, so it round-trips', () => {
    expect(project(P, project(P, 1000, 3, 90), 90, 3)).toBeCloseTo(1000, 6);
  });
});

describe('scoreV5 projection reproduces the v3/v4 est30 exactly at horizon 30', () => {
  // The blend is anchored on the FITTED bucket nearest the reading age. Indexing it by the raw
  // age instead silently zeroes both the global multiplier and the Q residual, which showed up
  // as a 28% gap between v5's projection and v4's stored est30 on a real video (Allrecipes
  // MpGDoiSH_PQ at 3.008d, 2026-09-04). This test is that bug.
  const P2: GlobalParams = { ...P, qBins: { 3: { edges: [0.2, 0.4, 0.6, 0.8], resid: [-0.2, -0.1, 0, 0.1, 0.25] } } };
  it('matches w*chm + (1-w)*g + qResidual at a non-bucket age', () => {
    const priorMultLogs = [0.4, 0.5, 0.6];
    const out = scoreV5({
      vt: 500000, age: 3.0082, snaps: [{ day: 1, views: 200000 }, { day: 3.0082, views: 500000 }],
      priors: [prior(3, [[3, 200000]]), prior(10, [[3, 220000]]), prior(20, [[3, 240000]])],
      priorMultLogs, params: P2,
    });
    const g = P2.mult[3]!, w = 3 / (3 + 1), chm = 0.5, qr = 0.25;   // q > 0.8 => top bin
    expect(out.q!).toBeGreaterThan(0.8);
    // v5 reads the global term at TRUE age, so it is logToRef(3.0082) rather than mult[3];
    // the channel and Q terms are read at the bucket, exactly as v3 does.
    const adj = w * (chm - g) + qr;
    expect(out.projection).toBeCloseTo(500000 * Math.exp(logToRef(P2, 3.0082) + adj), 2);
    // and it is within 0.1% of the v3 bucket-snapped form -- the gap is age, not a dropped term
    const v3 = 500000 * Math.exp(w * chm + (1 - w) * g + qr);
    expect(Math.abs(Math.log(out.projection / v3))).toBeLessThan(0.001);
  });
  it('is EXACTLY the v3 form at a bucket age', () => {
    const out = scoreV5({
      vt: 500000, age: 3, snaps: [{ day: 1, views: 200000 }, { day: 3, views: 500000 }],
      priors: [prior(3, [[3, 200000]]), prior(10, [[3, 220000]]), prior(20, [[3, 240000]])],
      priorMultLogs: [0.4, 0.5, 0.6], params: P2,
    });
    const g = P2.mult[3]!, w = 3 / (3 + 1);
    expect(out.projection).toBeCloseTo(500000 * Math.exp(w * 0.5 + (1 - w) * g + 0.25), 6);
  });
});

describe('typicalAt30 (the display anchor)', () => {
  it('is the channel curve read at day 30, not at the video age, and lands in baseline', () => {
    // Priors with a real day-30 reading of 1000 and a real day-1 reading of 100.
    const priors = Array.from({ length: 5 }, (_, i) => ({
      publishedAt: Date.UTC(2026, 0, 1 + i * 7),
      snaps: [{ day: 1, views: 100 }, { day: 30, views: 1000 }],
      lifetime: null,
    }));
    const params = (globalThis as any).__testParams ?? require('./core').defaultParamsForTests?.();
    if (!params) return; // no fixture available in this suite
    const out = scoreV5({
      vt: 250, age: 1, snaps: [{ day: 1, views: 250 }], priors: priors as any,
      publishedAt: Date.UTC(2026, 2, 1), params,
    } as any);
    expect(out.typicalAtAge).toBeCloseTo(100, 0);
    expect(out.typicalAt30).toBeCloseTo(1000, 0);
  });
});


// ---------------------------------------------------------------------------------------------
// The 2026-09-04 sub-day bug, pinned to the case that found it: KFVqHUvp-0w ("I FINALLY Fixed My
// Master Sword!", 3D Printing Nerd) at age 0.2268d (5.44h) with 5,345 views. The v5 row said
// typical_at_age = 15,477 (score 0.35) while the video page drew ~5K and the v3 row an hour
// earlier had same_age_ratio 1.52 -- channelCurve's sub-day typical was 3.6x too high.
//
// Two causes, both fixed:
//   1. contributionAt applied `blendScale` when sliding a prior BACKWARD below its anchor. The
//      scale is 1 + qResidual(anchor) / logToRef(anchor); logToRef is ~0.069 at day 17, so a
//      -0.070 residual gave the 0.10 clamp floor, flattening the slide: the day-17 prior kept
//      24,092 of its 29,327 views at five hours instead of 4,105.
//   2. Nothing stopped a day-17 snapshot (or a day-300 lifetime count) standing in for hour five
//      at all. Below one day a prior needs a real sample, or a sample under SUBDAY_SLIDE_MAX_AGE.
// ---------------------------------------------------------------------------------------------
describe('sub-day channel curve (KFVqHUvp-0w, 3D Printing Nerd, 2026-09-04)', () => {
  // score_params v5.0, fitted 2026-09-04T18:27:03Z.
  const PROD: GlobalParams = {
    mult: {
      [1 / 24]: 4.308, [2 / 24]: 3.632, [4 / 24]: 2.488, [8 / 24]: 1.469, [12 / 24]: 1.181,
      [18 / 24]: 0.983, 1: 0.874, 2: 0.610, 3: 0.452, 5: 0.303, 7: 0.225, 14: 0.096, 21: 0.038, 30: 0,
    },
    qBins: {
      3: { edges: [0.05, 0.12, 0.2, 0.33], resid: [-0.217, -0.11, 0, 0.09, 0.2] },
      5: { edges: [0.05, 0.12, 0.2, 0.33], resid: [-0.2, -0.166, 0, 0.08, 0.18] },
      14: { edges: [0.05, 0.12, 0.2, 0.33], resid: [-0.07, -0.04, -0.017, 0.02, 0.06] },
    },
    longtail: { ages: [60, 90, 180, 365, 730, 1500], mult: [1.087, 1.125, 1.125, 1.342, 1.342, 1.342], n: [900, 800, 700, 600, 400, 200] },
    fittedAt: '2026-09-04T18:27:03.001Z', nVideos: 5000,
  };
  const AGE = 0.2268;      // 5.44 hours
  const VIEWS = 5345;
  // The channel's real last 15 long-form priors, as loaded by scripts/score-videos.ts.
  const PRIORS: CurvePrior[] = [
    prior(7.00, [[3.9581, 30884], [4.4056, 30884], [4.9581, 31269], [5.0095, 31269], [5.9581, 31551], [6.9581, 31889], [7.0012, 31889]], [31889, 7.2]),
    prior(7.44, [[4.3999, 37270], [4.8475, 37270], [5.0022, 37528], [5.3999, 38105], [6.3999, 39605], [7.0021, 40976], [7.3999, 40976]], [40976, 7.7]),
    prior(14.00, [[10.958, 95994], [11.4056, 95994], [11.958, 96945], [13.958, 100438], [14.0012, 100438]], [100438, 14.2]),
    prior(20.00, [[16.958, 29327], [17.4056, 29327], [17.958, 29404]], [29404, 20.2]),
    prior(29.00, [[25.9583, 17157], [26.4479, 17157], [26.9583, 17210]], [17210, 29.2]),
    prior(35.00, [[31.9581, 36866]], [36866, 35.2]),
    prior(42.00, [[38.9579, 23467]], [23467, 42.2]),
    prior(49.00, [[45.9583, 11201]], [11201, 49.2]),
    prior(56.00, [[52.9579, 54149]], [54149, 56.2]),
    prior(63.00, [[59.9583, 30563]], [30563, 63.2]),
    prior(69.64, [[66.5936, 66102]], [66102, 69.9]),
    prior(77.00, [[75.9581, 17488]], [17488, 77.2]),
    prior(84.00, [[82.9582, 71553]], [71553, 84.2]),
    prior(91.00, [[89.9579, 25381]], [25381, 91.2]),
    prior(98.00, [[96.958, 185024]], [185024, 98.2]),
  ];

  // The day-30 path is untouched by the fix: sliding FORWARD from the anchor is the interval
  // blendScale was calibrated on, so the prior's own Q still corrects it and C(30) still reads
  // 34,820 on the live params (scripts/diagnose-curve.ts KFVqHUvp-0w). The unit fixture's qBins
  // are illustrative, so the invariant asserted here is the ROUTE, not that fixture's arithmetic.
  it('C(30) is untouched: the forward blend still applies toward day 30', () => {
    const p = PRIORS[0];                       // samples 3.96..7.00, so day 30 is forward of them
    const blended = contributionAt(p, 30, PROD)!;
    const q = growthExponent(p.samples.map((x) => ({ ...x })));
    expect(blended.kind).toBe('interpolated');
    expect(blended.fromAge).toBe(7.0012);
    expect(blended.views).toBeCloseTo(
      31889 * Math.exp(growthLog(PROD, 7.0012, 30, { anchorAge: 7.0012, q })), 6);
    const c30 = channelCurve(PRIORS, 30, PROD).typical!;
    expect(c30).toBeGreaterThan(20000);
    expect(c30).toBeLessThan(60000);
  });

  it('no prior stands in for hour five off a day-17 snapshot or a lifetime count', () => {
    const day17 = PRIORS[3];
    expect(contributionAt(day17, AGE, PROD)).toBeNull();          // was 24,092
    expect(contributionAt(prior(500, [], [150000, 400]), AGE, PROD)).toBeNull();
    // ...and the same prior still contributes normally at an age it can speak to.
    expect(contributionAt(day17, 25, PROD)!.kind).toBe('interpolated');
  });

  it('with no usable prior below a day the score is withheld, not invented', () => {
    const c = channelCurve(PRIORS, AGE, PROD);
    expect(c.n).toBe(0);
    expect(c.typical).toBeNull();
    const o = scoreV5({ vt: VIEWS, age: AGE, snaps: [{ day: 0.05, views: 900 }, { day: AGE, views: VIEWS }], priors: PRIORS, params: PROD });
    expect(o.score).toBeNull();
    expect(o.typicalAtAge).toBeNull();
    expect(o.confidence).toBe('early');          // a fact about the clock, not the channel
    expect(o.typicalAt30).toBeGreaterThan(33000); // the display anchor survives
  });

  it('a prior WITH a sub-day sample does contribute, and C(t) then agrees with the page', () => {
    // Give three priors a five-hour reading on the channel's own curve, anchored on C(30).
    const c30 = channelCurve(PRIORS, 30, PROD).typical!;
    const pageTypical = c30 * Math.exp(-logToRef(PROD, AGE));   // what video-curve.expectedAtAge draws
    const seeded = PRIORS.map((p, i) =>
      i < 3 ? { ...p, samples: [{ day: 0.22, views: Math.round(pageTypical) }, ...p.samples] } : p);
    const c = channelCurve(seeded, AGE, PROD);
    expect(c.n).toBe(3);
    expect(c.measuredShare).toBe(1);
    // one source of truth: lib/admin/video-curve.multAt defers to growth.logToRef when the params
    // carry a fitted launch ladder, so the page's typical and the score's denominator agree.
    expect(Math.abs(Math.log(c.typical! / pageTypical))).toBeLessThan(0.10);
    expect(VIEWS / c.typical!).toBeGreaterThan(1);   // 5,345 views is ABOVE typical, not 0.35x
    expect(VIEWS / c.typical!).toBeLessThan(1.6);
  });
});
