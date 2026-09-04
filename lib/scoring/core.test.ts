import { bucketFor, growthExponent, median, scoreVideo, fitParams, qResidual, fitLongTail, longtailAt, estimateV30, GlobalParams, logMultTo30, longtailFrom30, priorV30, publishGapDays, priorWindow, DAY_BUCKETS, HOUR_BUCKETS, fitLaunchLadder, fittedBuckets, bucketTolerance, channelBaseline, weightedMedian, effectiveN, baselineWeight, MIN_BASELINE_NEFF } from './core';

const params: GlobalParams = {
  mult: { 1: Math.log(2.2), 2: Math.log(1.9), 3: Math.log(1.4), 5: Math.log(1.25), 7: Math.log(1.12), 14: Math.log(1.05), 21: Math.log(1.02), 30: 0 },
  qBins: { 3: { edges: [0.2, 0.4, 0.6, 0.8], resid: [-0.2, -0.1, 0, 0.1, 0.25] } },
  fittedAt: '2026-09-02T00:00:00Z',
  nVideos: 1000,
};

describe('bucketFor', () => {
  test('snaps to the nearest schedule day', () => {
    expect(bucketFor(0.6, DAY_BUCKETS)).toBe(1);
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
    priorAgeDays: [0, 0, 0, 0, 0],
    priorSameAge: [400, 500, 600, 450, 550],
    params,
  };

  test('with no channel growth history it projects with the global multiplier plus the Q correction', () => {
    const out = scoreVideo({ ...base, priorMultLogs: [] });
    const q = growthExponent(base.snaps)!;                 // log(2)/log(2) = 1 -> top bin (+0.25)
    expect(out.est30).toBeCloseTo(1000 * Math.exp(Math.log(1.4) + 0.25), 6);
    expect(out.baseline).toBeCloseTo(1000, 6);
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
    expect(scoreVideo({ ...base, priorMultLogs: [], priorV30: [1, 2], priorAgeDays: [0, 0], priorSameAge: [] }).confidence).toBe('insufficient');
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

describe('fitLongTail / longtailAt / estimateV30', () => {
  // synthetic corpus: lifetime = v30 * trueMult(bucket), with noise-free medians
  const trueMult: Record<number, number> = { 60: 1.2, 90: 1.4, 180: 1.8, 365: 2.5, 730: 3.2, 1500: 4.0 };
  const rows: { age: number; v30: number; lifetime: number }[] = [];
  for (const [ageStr, m] of Object.entries(trueMult)) {
    const age = Number(ageStr) + 5;
    for (let i = 0; i < 40; i++) rows.push({ age, v30: 1000 + i, lifetime: (1000 + i) * m });
  }
  const t = fitLongTail(rows);

  test('buckets ages and recovers the median multiplier per bucket', () => {
    expect(t.ages).toEqual([60, 90, 180, 365, 730, 1500]);
    expect(t.n).toEqual([40, 40, 40, 40, 40, 40]);
    t.mult.forEach((m, i) => expect(m).toBeCloseTo(trueMult[t.ages[i]], 6));
  });

  test('is monotone non-decreasing and never below 1', () => {
    const noisy = fitLongTail([
      ...Array.from({ length: 30 }, () => ({ age: 70, v30: 100, lifetime: 300 })),   // 3.0
      ...Array.from({ length: 30 }, () => ({ age: 100, v30: 100, lifetime: 150 })),  // 1.5, would dip
      ...Array.from({ length: 30 }, () => ({ age: 200, v30: 100, lifetime: 50 })),   // 0.5, would dip
    ]);
    expect(noisy.mult).toEqual([3, 3, 3, 3, 3, 3]);
    const low = fitLongTail(Array.from({ length: 30 }, () => ({ age: 70, v30: 100, lifetime: 40 })));
    expect(low.mult[0]).toBe(1);                       // clamped up from 0.4
  });

  test('thin buckets carry the previous value forward', () => {
    const sparse = fitLongTail([
      ...Array.from({ length: 30 }, () => ({ age: 70, v30: 100, lifetime: 120 })),
      ...Array.from({ length: 3 }, () => ({ age: 100, v30: 100, lifetime: 900 })),   // below minRows
    ]);
    expect(sparse.mult[0]).toBe(1.2);
    expect(sparse.mult[1]).toBe(1.2);
    expect(sparse.n[1]).toBe(3);
  });

  test('longtailAt interpolates in log(age) and clamps at both ends', () => {
    expect(longtailAt(t, 10)).toBeCloseTo(1.2, 6);
    expect(longtailAt(t, 60)).toBeCloseTo(1.2, 6);
    expect(longtailAt(t, 5000)).toBeCloseTo(4.0, 6);
    const mid = longtailAt(t, 120);
    expect(mid).toBeGreaterThan(1.4);
    expect(mid).toBeLessThan(1.8);
    // exactly halfway in log space between 90 and 180
    expect(longtailAt(t, Math.sqrt(90 * 180))).toBeCloseTo((1.4 + 1.8) / 2, 6);
    expect(longtailAt(undefined, 300)).toBe(1);
  });

  test('estimateV30 prefers the snapshot, falls back to lifetime, else null', () => {
    expect(estimateV30(5000, 90000, 400, t)).toEqual({ v30: 5000, fromLifetime: false });
    const est = estimateV30(null, 9000, 365, t)!;
    expect(est.fromLifetime).toBe(true);
    expect(est.v30).toBeCloseTo(9000 / 2.5, 6);
    expect(estimateV30(null, 9000, 30, t)).toBeNull();   // too young to normalize
    expect(estimateV30(null, 0, 400, t)).toBeNull();
    expect(estimateV30(0, 9000, 50, t)!.fromLifetime).toBe(true); // age 50 >= 45, clamped mult
  });
});

describe('confidence with lifetime-derived baselines', () => {
  test("'insufficient' only below 3 priors, regardless of same-age history", () => {
    const base = { vt: 1000, day: 20, snaps: [{ day: 1, views: 500 }, { day: 20, views: 1000 }], priorMultLogs: [], priorAgeDays: [0, 0, 0], priorSameAge: [], params };
    expect(scoreVideo({ ...base, priorV30: [900, 1000, 1100] }).confidence).toBe('confirmed');
    expect(scoreVideo({ ...base, priorV30: [900, 1000] }).confidence).toBe('insufficient');
    expect(scoreVideo({ ...base, priorV30: [900, 1000], priorSameAge: [1, 2, 3] }).confidence).toBe('insufficient');
  });
  test('priorsFromLifetime is carried through to the output', () => {
    const out = scoreVideo({ vt: 1000, day: 20, snaps: [], priorMultLogs: [], priorV30: [900, 1000, 1100], priorAgeDays: [0, 0, 0], priorSameAge: [], priorsFromLifetime: 2, params });
    expect(out.priorsFromLifetime).toBe(2);
    expect(out.nBaseline).toBe(3);
  });
});

describe('prior day-30 estimation (baseline from young priors)', () => {
  const params: GlobalParams = {
    mult: { 1: Math.log(2.27), 2: Math.log(1.75), 3: Math.log(1.52), 5: Math.log(1.31), 7: Math.log(1.22), 14: Math.log(1.09), 21: Math.log(1.03), 30: 0 },
    qBins: {}, fittedAt: 'x', nVideos: 0,
    longtail: { ages: [60, 90, 180, 365, 730, 1500], mult: [1.08, 1.11, 1.11, 1.26, 1.26, 1.26], n: [1, 1, 1, 1, 1, 1] },
  };

  it('logMultTo30 hits the buckets exactly and is zero from day 30', () => {
    expect(logMultTo30(params, 1)).toBeCloseTo(Math.log(2.27));
    expect(logMultTo30(params, 7)).toBeCloseTo(Math.log(1.22));
    expect(logMultTo30(params, 30)).toBe(0);
    expect(logMultTo30(params, 45)).toBe(0);
  });
  it('logMultTo30 interpolates between buckets and clamps below day 1', () => {
    const d4 = logMultTo30(params, 4);
    expect(d4).toBeLessThan(Math.log(1.52));
    expect(d4).toBeGreaterThan(Math.log(1.31));
    expect(logMultTo30(params, 0.3)).toBeCloseTo(Math.log(2.27));
  });
  it('longtailFrom30 ramps from 1 at day 30 to the 60-day value', () => {
    expect(longtailFrom30(params.longtail, 30)).toBe(1);
    expect(longtailFrom30(params.longtail, 45)).toBeCloseTo(1.04);
    expect(longtailFrom30(params.longtail, 60)).toBeCloseTo(1.08);
    expect(longtailFrom30(params.longtail, 365)).toBeCloseTo(1.26);
  });
  it('priorV30 prefers a real day-30 read', () => {
    expect(priorV30(1000, { day: 5, views: 400 }, params)).toEqual({ v30: 1000, kind: 'real' });
  });
  it('priorV30 projects a young prior up the growth curve', () => {
    const e = priorV30(null, { day: 7, views: 1000 }, params)!;
    expect(e.kind).toBe('projected');
    expect(e.v30).toBeCloseTo(1220);
  });
  it('priorV30 refuses a prior younger than MIN_PROJECT_AGE', () => {
    expect(priorV30(null, { day: 1.5, views: 1000 }, params)).toBeNull();
    expect(priorV30(null, { day: 2, views: 1000 }, params)?.kind).toBe('projected');
  });
  it('priorV30 divides an old prior down the long tail, keyed to the snapshot age', () => {
    const e = priorV30(null, { day: 365, views: 1260 }, params)!;
    expect(e.kind).toBe('lifetime');
    expect(e.v30).toBeCloseTo(1000);
  });
  it('priorV30 returns null with no usable record', () => {
    expect(priorV30(null, null, params)).toBeNull();
    expect(priorV30(null, { day: 10, views: 0 }, params)).toBeNull();
  });
  it('a daily channel with 10 young priors now gets a baseline', () => {
    const v30s = Array.from({ length: 10 }, (_, i) => priorV30(null, { day: 2 + i, views: 10000 }, params)!.v30);
    const out = scoreVideo({ vt: 5000, day: 0.5, snaps: [{ day: 0.5, views: 5000 }], priorMultLogs: [], priorV30: v30s, priorAgeDays: v30s.map(() => 0), priorSameAge: [], priorsProjected: 10, params });
    expect(out.baseline).not.toBeNull();
    expect(out.nBaseline).toBe(10);
    expect(out.priorsProjected).toBe(10);
    expect(out.confidence).toBe('early');
  });
  it('publishGapDays / priorWindow: daily -> 15 priors, sparse -> 10', () => {
    const day = 86_400_000;
    expect(publishGapDays([0, day, 2 * day, 3 * day])).toBe(1);
    expect(priorWindow(1)).toBe(15);
    expect(priorWindow(14)).toBe(10);
    expect(priorWindow(null)).toBe(15);
    expect(publishGapDays([0, day])).toBeNull();
  });
});

describe('launch ladder (sub-day buckets)', () => {
  const day1 = Math.log(2.27);
  const rows = (hours: number, ratio: number, n: number) => Array.from({ length: n }, (_, i) => ({ hours: hours + (i % 3) * 0.05, vh: 1000, v1: 1000 * ratio }));
  it('chains each hour bucket through day 1 and keeps the ladder monotone', () => {
    const r = [...rows(1, 8, 60), ...rows(4, 3, 60), ...rows(12, 1.5, 60), ...rows(18, 1.2, 60)];
    const { mult, n } = fitLaunchLadder(r, day1);
    expect(n[1 / 24]).toBe(60);
    expect(Math.exp(mult[1 / 24])).toBeCloseTo(8 * 2.27, 1);
    expect(Math.exp(mult[12 / 24])).toBeCloseTo(1.5 * 2.27, 1);
    expect(mult[1 / 24]).toBeGreaterThanOrEqual(mult[4 / 24]);
    expect(mult[4 / 24]).toBeGreaterThanOrEqual(mult[12 / 24]);
    expect(mult[12 / 24]).toBeGreaterThanOrEqual(mult[18 / 24]);
    expect(mult[2 / 24]).toBeUndefined(); // no rows near 2h
  });
  it('drops a bucket below minRows and never reports less growth than day 1', () => {
    const { mult } = fitLaunchLadder([...rows(1, 8, 10), ...rows(18, 0.9, 60)], day1);
    expect(mult[1 / 24]).toBeUndefined();
    expect(mult[18 / 24]).toBeCloseTo(day1, 6);
  });
  it('bucketFor picks the nearest bucket in log-age, only among fitted buckets', () => {
    expect(bucketFor(3 / 24)).toBeCloseTo(4 / 24, 9);
    expect(bucketFor(0.5)).toBeCloseTo(12 / 24, 9);
    expect(bucketFor(0.5, DAY_BUCKETS)).toBe(1);
    expect(bucketFor(0.9)).toBe(1);
    expect(bucketFor(20)).toBe(21);
  });
  it('scoreVideo uses the hour multiplier when fitted, else falls back to the day-1 bucket', () => {
    const base: GlobalParams = { mult: { 1: Math.log(2.27), 3: Math.log(1.52), 30: 0 }, qBins: {}, fittedAt: 'x', nVideos: 0 };
    const without = scoreVideo({ vt: 10000, day: 0.5, snaps: [{ day: 0.5, views: 10000 }], priorMultLogs: [], priorV30: [], priorAgeDays: [], priorSameAge: [], params: base });
    expect(without.bucket).toBe(1);
    expect(without.est30).toBeCloseTo(22700, 0);
    const withLadder: GlobalParams = { ...base, mult: { ...base.mult, [12 / 24]: Math.log(3.4) } };
    const w = scoreVideo({ vt: 10000, day: 0.5, snaps: [{ day: 0.5, views: 10000 }], priorMultLogs: [], priorV30: [], priorAgeDays: [], priorSameAge: [], params: withLadder });
    expect(w.bucket).toBeCloseTo(12 / 24, 9);
    expect(w.est30).toBeCloseTo(34000, 0);
    expect(fittedBuckets(withLadder)).toEqual([12 / 24, 1, 3, 30]);
  });
  it('bucketTolerance is a quarter of the age inside day 1', () => {
    expect(bucketTolerance(12 / 24)).toBeCloseTo(0.125, 9);
    expect(bucketTolerance(1 / 24)).toBeCloseTo(1 / 48, 9);
    expect(bucketTolerance(3)).toBe(1);
    expect(bucketTolerance(14)).toBe(3);
  });
});

// ---- v4.0 channel baseline: time-weighted median in log space ----
describe('channelBaseline (v4.0)', () => {
  const ages = (n: number, a = 0) => Array.from({ length: n }, () => a);

  it('equal weights reduce to the plain median', () => {
    const odd = [800, 900, 1000, 1100, 1200];
    expect(channelBaseline(odd, ages(5)).baseline).toBeCloseTo(median(odd)!, 9);
    // even count: the tie-break averages the two middles -- in log space, i.e. geometrically
    const even = [800, 900, 1000, 1200];
    expect(channelBaseline(even, ages(4)).baseline).toBeCloseTo(Math.sqrt(900 * 1000), 9);
    // ...and identical ages give the same answer whatever that age is
    expect(channelBaseline(odd, ages(5, 240)).baseline).toBeCloseTo(median(odd)!, 9);
  });

  it('weightedMedian with equal weights matches median, and honours weight mass', () => {
    expect(weightedMedian([3, 1, 2], [1, 1, 1])).toBe(2);
    expect(weightedMedian([1, 2, 3, 4], [1, 1, 1, 1])).toBe(2.5);
    // all the mass on one value picks that value
    expect(weightedMedian([1, 2, 3], [0.01, 100, 0.01])).toBe(2);
    expect(weightedMedian([], [])).toBeNull();
    expect(weightedMedian([1, 2], [0, 0])).toBeNull();
  });

  it('down-weights old priors', () => {
    // the channel's level moved: its two most recent videos do 1,000, its older ones did 50,000
    const v30 = [1000, 1000, 50000, 50000, 50000];
    // unweighted, the three stale videos outvote the two recent ones
    expect(channelBaseline(v30, ages(5)).baseline).toBeCloseTo(50000, 6);
    // weighted by age the recent pair carries most of the mass and decides
    const w = channelBaseline(v30, [0, 10, 60, 70, 80]);
    expect(w.baseline).toBeCloseTo(1000, 6);
    expect(w.neff).toBeGreaterThan(MIN_BASELINE_NEFF);
    // and a lone ancient freak cannot move a baseline the recent pack agrees on
    const freak = channelBaseline([1000, 1050, 950, 1100, 100000], [2, 9, 16, 23, 500]);
    expect(freak.baseline).toBeCloseTo(1000, 6);
  });

  it('half-life 30 halves a prior weight every 30 days', () => {
    expect(baselineWeight(0)).toBe(1);
    expect(baselineWeight(30)).toBeCloseTo(0.5, 12);
    expect(baselineWeight(60)).toBeCloseTo(0.25, 12);
    expect(baselineWeight(-5)).toBe(1);          // a prior cannot be published after the target
    expect(baselineWeight(NaN)).toBe(1);
  });

  it('applies the effective-n floor', () => {
    expect(effectiveN([1, 1, 1, 1])).toBeCloseTo(4, 9);
    // one recent prior plus a tail of near-zero weights is not a channel history
    const thin = channelBaseline([1000, 900, 1100], [0, 400, 500]);
    expect(thin.neff).toBeLessThan(MIN_BASELINE_NEFF);
    expect(thin.baseline).toBeNull();
    expect(thin.nPriors).toBe(3);
    // the same three priors spread over a month clear the floor
    const ok = channelBaseline([1000, 900, 1100], [0, 15, 30]);
    expect(ok.neff).toBeGreaterThanOrEqual(MIN_BASELINE_NEFF);
    expect(ok.baseline).not.toBeNull();
  });

  it('applies the 3-prior floor', () => {
    expect(channelBaseline([1000, 1000], [0, 0]).baseline).toBeNull();
    expect(channelBaseline([1000, 1000, 1000], [0, 0, 0]).baseline).toBeCloseTo(1000, 9);
    // non-positive / non-finite estimates do not count toward the floor
    expect(channelBaseline([1000, 0, -5, NaN], [0, 0, 0, 0]).nPriors).toBe(1);
    expect(channelBaseline([1000, 0, -5, NaN], [0, 0, 0, 0]).baseline).toBeNull();
    expect(channelBaseline([], []).baseline).toBeNull();
  });

  it('scoreVideo reports the baseline neff and calls it insufficient when the floors fail', () => {
    const base = {
      vt: 1000, day: 9, snaps: [{ day: 1, views: 500 }, { day: 9, views: 1000 }],
      priorMultLogs: [], priorSameAge: [], params,
    };
    const good = scoreVideo({ ...base, priorV30: [1000, 900, 1100], priorAgeDays: [0, 15, 30] });
    expect(good.baseline).not.toBeNull();
    expect(good.confidence).toBe('confirmed');
    expect(good.baselineNeff).toBeGreaterThanOrEqual(MIN_BASELINE_NEFF);
    const thin = scoreVideo({ ...base, priorV30: [1000, 900, 1100], priorAgeDays: [0, 400, 500] });
    expect(thin.baseline).toBeNull();
    expect(thin.score).toBeNull();
    expect(thin.confidence).toBe('insufficient');
    expect(thin.nBaseline).toBe(3);          // still reports how many priors there were
  });
});
