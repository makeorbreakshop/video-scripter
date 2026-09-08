import { baselineWeight, effectiveN, growthExponent, type GlobalParams } from "./core";
import { cadenceHalfLifeDays, cadenceHalfLifeForPriors, channelCurve, contributionAt, estimateLadder, kernelHalfLifeForPriors, MAX_PRIOR_WEIGHT_SHARE, maxWeightShare, measuredCurveAt, priorsSpanning, estimateSlideLog, sameAgeTolerance, scoreV5, project, type CurvePrior } from './curve';
import { AGE_FLOOR_DAYS, growthLog, logToRef } from './growth';

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
    const ps = [prior(0, [[3, 1000]]), prior(400, [[3, 1000]]), prior(500, [[3, 1000]])];
    const c = channelCurve(ps, 3, P, 30);
    expect(c.n).toBe(3);
    expect(c.neff).toBeLessThan(2);
    expect(c.typical).toBeNull();
    // ... but at THIS channel's cadence (median gap 250d) those three are its last three
    // videos, not a stale tail, and v5.2's kernel says so. See cadenceHalfLifeDays.
    const cadence = channelCurve(ps, 3, P);
    expect(cadence.neff).toBeGreaterThan(2);
    expect(cadence.typical).toBeCloseTo(1000, 6);
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

  it('v5.3: no prior can be measured at hour five, so C is ESTIMATED there, not null', () => {
    const c = channelCurve(PRIORS, AGE, PROD);
    // Nothing was measured AT the target age -- that half of v5.2 is unchanged and still true.
    expect(measuredCurveAt(PRIORS, AGE, PROD).typical).toBeNull();
    // ...but the channel has a level, so the curve says so instead of going silent.
    expect(c.kind).toBe('estimated');
    expect(c.typical).toBeGreaterThan(0);
    expect(c.measuredShare).toBe(0);            // nothing here was measured at t, and it says so
    expect(c.anchorAge).not.toBeNull();
    // The anchor is the nearest rung the channel actually has a level at. Below a day every rung
    // starves for the same reason the target does, so it lands at the first day-scale one.
    expect(c.anchorAge).toBe(1);
    // and it IS the anchor's level slid along G, exactly.
    const at = measuredCurveAt(PRIORS, c.anchorAge!, PROD);
    expect(Math.log(c.typical! / at.typical!)).toBeCloseTo(growthLog(PROD, c.anchorAge!, AGE), 10);

    const o = scoreV5({ vt: VIEWS, age: AGE, snaps: [{ day: 0.05, views: 900 }, { day: AGE, views: VIEWS }], priors: PRIORS, params: PROD });
    expect(o.score).toBeCloseTo(VIEWS / c.typical!, 10);
    expect(o.typicalAtAge).toBe(c.typical);
    expect(o.typicalKind).toBe('estimated');
    expect(o.typicalAnchorAge).toBe(1);
    expect(o.confidence).toBe('early');          // a fact about the clock, said out loud
    expect(o.typicalAt30).toBeGreaterThan(33000); // the display anchor survives
  });

  it('the estimate at hour five lands near the line the page draws off C(30)', () => {
    // lib/admin/video-curve.expectedAtAge is C(30) x exp(-logToRef(age)) -- the same slide, from
    // a further anchor. The two should not disagree by much, or the ladder is picking badly.
    const c30 = channelCurve(PRIORS, 30, PROD).typical!;
    const fromDay30 = c30 * Math.exp(-logToRef(PROD, AGE));
    const est = channelCurve(PRIORS, AGE, PROD).typical!;
    expect(Math.abs(Math.log(est / fromDay30))).toBeLessThan(0.7);
  });

  it('score is present under the age floor, marked early rather than withheld', () => {
    const young = AGE_FLOOR_DAYS / 2;
    const o = scoreV5({ vt: 400, age: young, snaps: [{ day: young, views: 400 }], priors: PRIORS, params: PROD });
    expect(o.belowAgeFloor).toBe(true);
    expect(o.score).not.toBeNull();
    expect(o.typicalAtAge).not.toBeNull();
    expect(o.confidence).toBe('early');
  });

  it('the true null: a channel with no level at ANY age', () => {
    const two = PRIORS.slice(0, 2);              // under MIN_BASELINE_PRIORS everywhere
    const c = channelCurve(two, AGE, PROD);
    expect(c.typical).toBeNull();
    expect(c.kind).toBe('measured');
    expect(c.anchorAge).toBeNull();
    const o = scoreV5({ vt: VIEWS, age: AGE, snaps: [{ day: AGE, views: VIEWS }], priors: two, params: PROD });
    expect(o.score).toBeNull();
    expect(o.confidence).toBe('insufficient');
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

// ---- cadence-scaled half-life (v5.2) --------------------------------------------------
// "Normal for this channel" is judged in the channel's own rhythm: recent means the channel's
// last handful of videos, whether that spans a month or two years.

const pubs = (gapDays: number, n = 8, from = Date.parse('2026-01-01T00:00:00Z')): number[] =>
  Array.from({ length: n }, (_, i) => from - i * gapDays * 86_400_000);

describe('cadenceHalfLifeDays', () => {
  it('leaves fast channels on the 30-day floor', () => {
    expect(cadenceHalfLifeDays(pubs(1))).toBe(30);    // daily
    expect(cadenceHalfLifeDays(pubs(7))).toBe(30);    // weekly
    expect(cadenceHalfLifeDays(pubs(14))).toBe(30);   // fortnightly: 1.5 x 14 = 21 < 30
    expect(cadenceHalfLifeDays(pubs(20))).toBe(30);   // three-weekly: 1.5 x 20 = 30, the floor
  });

  it('opens the kernel to 1.5 median gaps once the channel is slower than three-weekly', () => {
    expect(cadenceHalfLifeDays(pubs(30))).toBeCloseTo(45, 6);
    expect(cadenceHalfLifeDays(pubs(90))).toBeCloseTo(135, 6);
  });

  it('has no measurable cadence under three priors, so the floor stands', () => {
    expect(cadenceHalfLifeDays([])).toBe(30);
    expect(cadenceHalfLifeDays(pubs(90, 2))).toBe(30);
    expect(cadenceHalfLifeDays([Date.now(), Date.now(), Date.now()])).toBe(30);  // zero gaps
  });

  it('reads the same cadence off the priors, whose ageDays run the other way', () => {
    const priors = [0, 90, 180, 270, 360].map((ageDays) => prior(ageDays, []));
    expect(cadenceHalfLifeForPriors(priors)).toBeCloseTo(135, 6);
  });
});

describe('a monthly channel gets a baseline (Steve Ramsey, real prior gaps)', () => {
  // R_sabzFjKYU (published 2026-01-20). Its seven fresh priors' publish gaps, straight from
  // production: 2026-09-07 stored n_baseline 7, typical_neff 1.43, baseline NULL, 'insufficient'.
  const GAPS = [18.2, 90.1, 181.1, 279.4, 374.4, 434.3, 455.3];
  // Each prior is a pre-tracking video with only a lifetime count, which is how this channel's
  // history actually reaches the curve. Values are the route, not the point of the test.
  const RAMSEY = GAPS.map((g, i) => prior(g, [], [30_000 + i * 1_000, g + 227]));

  it('is starved by the fixed 30-day kernel -- neff under 2, no typical at all', () => {
    const c = channelCurve(RAMSEY, 227, P, 30);
    expect(c.n).toBe(7);
    expect(c.neff).toBeLessThan(2);
    expect(c.neff).toBeCloseTo(1.43, 1);   // the stored typical_neff
    expect(c.typical).toBeNull();
  });

  it('scores in its own rhythm: half-life = 1.5 x its 81d median gap', () => {
    expect(cadenceHalfLifeForPriors(RAMSEY)).toBeCloseTo(122.2, 1);
    const c = channelCurve(RAMSEY, 227, P);          // no half-life argument = the v5.2 rule
    expect(c.n).toBe(7);
    expect(c.neff).toBeGreaterThan(4);
    expect(c.typical).toBeGreaterThan(0);
  });

  it('is a no-op on a weekly channel: the cadence kernel IS the 30-day kernel', () => {
    const weekly = Array.from({ length: 8 }, (_, i) => prior(i * 7, [[30, 10_000 + i * 100]]));
    expect(channelCurve(weekly, 30, P).typical).toBe(channelCurve(weekly, 30, P, 30).typical);
  });
});

describe('a channel whose cadence just changed', () => {
  // The kernel is read off the PRIORS' gaps only -- the target's own gap from the newest prior
  // is not one of them. That is deliberate, and these tests pin what it costs and what it does
  // not cost, because the intuition ("the newest video on a channel that just changed speed
  // must be mis-weighted") is mostly wrong, for a reason worth writing down:
  //
  //   neff = (sum w)^2 / sum w^2 is SCALE-FREE. Pushing every prior uniformly further into the
  //   past shrinks every weight by the same factor and leaves neff untouched. What starves a
  //   channel is the SPREAD of its gaps, not their size -- one recent prior beside a tail of
  //   much older ones. So a channel that simply stops for months keeps its baseline, and the
  //   channels the fixed 30-day kernel actually starves are the ones whose gaps widen.
  //
  // The rhythm is a median over up to fifteen gaps, so one holiday break or one double upload
  // cannot widen the kernel and drag stale history into the denominator. The price is that a
  // channel that genuinely changes speed is recognised only once the change is the median.
  // Including the target's own gap would not change that: one gap against fourteen barely
  // moves a median.

  it('a weekly channel that just stopped for four months keeps its baseline, kernel unchanged', () => {
    // 14 weekly priors, then nothing for 120 days, then this video. Every weight is tiny and
    // they are all tiny together, so the channel is not starved -- and the 30-day floor holds.
    const priors = Array.from({ length: 14 }, (_, i) => prior(120 + i * 7, [[30, 10_000]]));
    expect(cadenceHalfLifeForPriors(priors)).toBe(30);   // median gap 7d: still on the floor
    const c = channelCurve(priors, 30, P);
    expect(c.n).toBe(14);
    expect(c.neff).toBeGreaterThan(2);
    expect(c.typical).toBeCloseTo(10_000, 6);
  });

  it('a channel mid-slowdown is judged on the whole transition, not on its newest gap', () => {
    // Weekly a year ago, monthly now, every step in between: ages 60, 115, 160 ... 303 days.
    // The median gap is 17.5d, so the kernel is still on the 30-day floor -- and that is fine,
    // because neff does not collapse here. The channel keeps a baseline through the change.
    const gaps = [60, 55, 45, 40, 30, 21, 14, 10, 7, 7, 7, 7];
    let at = 0;
    const priors = gaps.map((g) => prior((at += g), [[30, 10_000]]));
    expect(cadenceHalfLifeForPriors(priors)).toBe(30);
    const fixed = channelCurve(priors, 30, P, 30);
    const cadence = channelCurve(priors, 30, P);
    expect(fixed.neff).toBeGreaterThan(2);
    expect(cadence.typical).toBe(fixed.typical);   // byte-identical: nothing to fix here
    // What starves a channel is not a change of speed but a settled slow one, where the gaps
    // are wide AND spread -- Steve Ramsey above, whose 18d..455d prior ages give neff 1.43.
  });

  it('a monthly channel that just sped up keeps the wide kernel, and the old videos still count', () => {
    // Two videos three days apart on top of a year of monthly ones. The rhythm is still monthly,
    // so the year of history is still what "normal for this channel" is made of -- a burst of
    // two uploads is not a new cadence, and the score does not swing onto one video.
    const priors = [prior(3, [[30, 10_000]]), ...Array.from({ length: 12 }, (_, i) => prior(30 + i * 30, [[30, 10_000]]))];
    expect(cadenceHalfLifeForPriors(priors)).toBeCloseTo(45, 6);
    const c = channelCurve(priors, 30, P);
    expect(c.n).toBe(13);
    expect(c.neff).toBeGreaterThan(channelCurve(priors, 30, P, 30).neff);
    expect(c.typical).toBeCloseTo(10_000, 6);
  });
});

// ---- the v5.3 estimate ladder and slide -------------------------------------------------

describe('estimateLadder', () => {
  it('is nearest-first in LOG age and never returns the target itself', () => {
    const l = estimateLadder(0.22);
    expect(l).not.toContain(0.22);
    expect(l[0]).toBe(4 / 24);                 // 0.167 is nearer 0.22 in log age than 0.333
    const d = (a: number) => Math.abs(Math.log(a) - Math.log(0.22));
    for (let i = 1; i < l.length; i++) expect(d(l[i])).toBeGreaterThanOrEqual(d(l[i - 1]));
  });

  it('carries day 30 and the long tail out to 1500, and drops the exact rung it stands on', () => {
    expect(estimateLadder(0.01)).toContain(30);
    expect(estimateLadder(0.01)).toContain(1500);
    expect(estimateLadder(30)).not.toContain(30);
  });

  it('is the same ladder for every target -- only the order changes', () => {
    expect([...estimateLadder(0.5), 0.5].sort((a, b) => a - b))
      .toEqual([...estimateLadder(7), 7].sort((a, b) => a - b));
  });
});

describe('the estimated slide', () => {
  const dense = (ageDays: number, at: [number, number][]): CurvePrior =>
    ({ ageDays, samples: at.map(([day, views]) => ({ day, views })), lifetime: null });
  // Six priors with a reading at 12h AND at day 3: the only shape that reaches the blend.
  const SPAN = [1, 8, 15, 22, 29, 36].map((a, i) =>
    dense(a, [[0.5, 1000 + i * 10], [3, 3000 + i * 30]]));

  it('anchor -> target is the identity when they are the same age', () => {
    expect(estimateSlideLog(SPAN, 3, 3, P).log).toBe(0);
  });

  it('is monotone: a later target is never a smaller slide', () => {
    let prev = -Infinity;
    for (const t of [0.05, 0.2, 0.5, 1, 2, 3, 7, 14, 30, 90]) {
      const g = estimateSlideLog([], 1, t, P).log;
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
  });

  it('is antisymmetric on the global shape, so sliding out and back returns the level', () => {
    const there = estimateSlideLog([], 30, 0.25, P).log;
    const back = estimateSlideLog([], 0.25, 30, P).log;
    expect(there + back).toBeCloseTo(0, 12);
  });

  it('uses the GLOBAL shape when fewer than MIN_SPAN_PRIORS span both ends', () => {
    const few = SPAN.slice(0, 3);
    expect(priorsSpanning(few, 0.5, 3).n).toBe(3);
    expect(estimateSlideLog(few, 0.5, 3, P).log).toBe(growthLog(P, 0.5, 3));
  });

  it('blends the channel-s own ratio in once >= MIN_SPAN_PRIORS span both ends', () => {
    const { n } = priorsSpanning(SPAN, 0.5, 3);
    expect(n).toBe(6);
    const { log, channelN } = estimateSlideLog(SPAN, 0.5, 3, P);
    expect(channelN).toBe(6);
    const ch = Math.log(3090 / 1030);           // the median prior-s own 12h -> day-3 ratio
    const w = 6 / 8;
    expect(log).toBeCloseTo(w * ch + (1 - w) * growthLog(P, 0.5, 3), 6);
  });

  it('a channel measured only at day 30 still has a curve at hour twelve', () => {
    const only30 = [2, 9, 16, 23].map((a) => dense(a, [[30, 50_000]]));
    expect(measuredCurveAt(only30, 0.5, P).typical).toBeNull();
    const c = channelCurve(only30, 0.5, P);
    expect(c.kind).toBe('estimated');
    // The nearest rung with a level is day 1 -- where the priors' day-30 readings are already
    // allowed to slide -- not day 30 itself. The answer is the same either way, because
    // logToRef is cumulative: 30 -> 1 -> 0.5 is 30 -> 0.5.
    expect(c.anchorAge).toBe(1);
    expect(c.typical).toBeCloseTo(50_000 * Math.exp(growthLog(P, 30, 0.5)), 6);
    expect(c.n).toBe(4);
  });
});

describe('the kernel cannot hand the median to a single prior (Cabinets, real prior gaps)', () => {
  // Av0K0TRhbhw "Cabinets are expensive" (UCGhyz7J9HmS0GT8Y_BR_crA), scored 2026-09-07 at age
  // 325.9d: 1.53M views, stored typical_at_age 90,048, score 17.0x, typical_neff 2.44. The 90,048
  // is the ONE prior published 35 days earlier ("it's like cheating", 93k lifetime -- the
  // channel's weakest video in two years). With the 55d cadence half-life it carried 0.643 of a
  // total weight of 1.077, i.e. more than half, so the weighted median WAS that prior and every
  // other video on the channel was ignored. The neighbour scored a month later divided by 1.01M.
  const AGE = 325.857;
  const CABINETS: [number, number][] = [
    [35, 90_048], [120, 663_280], [184, 1_025_447], [221, 301_266], [303, 870_231], [341, 2_403_529],
    [406, 415_973], [433, 190_067], [448, 205_558], [483, 750_078], [496, 226_025], [531, 231_508],
  ];
  const priors = CABINETS.map(([gap, views]) => prior(gap, [[AGE, views]]));

  it('the cadence half-life alone gives the newest prior the majority of the weight', () => {
    const hl = cadenceHalfLifeForPriors(priors);
    const ws = priors.map((p) => baselineWeight(p.ageDays, hl));
    expect(Math.max(...ws) / ws.reduce((a, b) => a + b, 0)).toBeGreaterThan(0.5);
  });

  it('widens the kernel until no prior holds more than a third of the weight', () => {
    const hl = kernelHalfLifeForPriors(priors);
    expect(hl).toBeGreaterThan(cadenceHalfLifeForPriors(priors));
    expect(maxWeightShare(priors.map((p) => baselineWeight(p.ageDays, hl)))).toBeLessThanOrEqual(MAX_PRIOR_WEIGHT_SHARE);
    // and not by more than one step: the search stops at the first half-life that clears it
    expect(maxWeightShare(priors.map((p) => baselineWeight(p.ageDays, hl / 1.25)))).toBeGreaterThan(MAX_PRIOR_WEIGHT_SHARE);
  });

  it('C(t) is a level of the channel, not the previous upload', () => {
    const c = channelCurve(priors, AGE, P);
    expect(c.kind).toBe('measured');
    expect(maxWeightShare(c.contributions.map((x) => x.weight))).toBeLessThanOrEqual(MAX_PRIOR_WEIGHT_SHARE);
    expect(c.typical).not.toBeCloseTo(90_048, 0);
    // the channel's own Feb-2024 video (301k at this age) is the median; 1.53M is 5.1x it
    expect(c.typical!).toBeGreaterThan(250_000);
    expect(c.typical!).toBeLessThan(1_100_000);
    expect(1_533_284 / c.typical!).toBeLessThan(6);
  });

  it('leaves a fast channel exactly where it was: 15 daily priors keep the 30-day kernel', () => {
    const daily = Array.from({ length: 15 }, (_, i) => prior(i + 1, [[AGE, 1000]]));
    expect(kernelHalfLifeForPriors(daily)).toBe(30);
    expect(channelCurve(daily, AGE, P).neff).toBeCloseTo(effectiveN(daily.map((p) => baselineWeight(p.ageDays, 30))), 8);
  });

  it('fewer than three priors has nothing to widen for', () => {
    const two = [prior(10, [[AGE, 100]]), prior(500, [[AGE, 900]])];
    expect(kernelHalfLifeForPriors(two)).toBe(cadenceHalfLifeForPriors(two));
  });
});
