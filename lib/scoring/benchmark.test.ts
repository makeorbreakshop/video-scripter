import {
  medALE, bias, outlierStats, spearman, withinChannelSpearman, confidenceCalibration,
  stability, changedAfter, stratumRows, cellFor, buildReport, compareReports, liftSummary,
  quantile, medALEThreshold, verdictLower, verdictHigher, reportMarkdown,
  MEDALE_FLOOR, MEDALE_REL, F1_ABS,
  type BenchRow, type LiftRow,
} from './benchmark';

const row = (o: Partial<BenchRow> & { videoId: string; est30: number; actual30: number }): BenchRow => ({
  channelId: 'c1', split: 'heldout', t: 3, day: 3, baseline: 100, score: o.est30 / 100,
  confidence: 'likely', q: null, truthDay: 30, packaging: [], packagingCoverage: 'none',
  ...o,
});

describe('medALE and bias (known answers)', () => {
  // ratios exp(+0.1), exp(-0.3), exp(+0.2): |log| = .1 .3 .2 -> median .2; signed median +.1
  const rows = [
    row({ videoId: 'a', actual30: 1000, est30: 1000 * Math.exp(0.1) }),
    row({ videoId: 'b', actual30: 1000, est30: 1000 * Math.exp(-0.3) }),
    row({ videoId: 'c', actual30: 1000, est30: 1000 * Math.exp(0.2) }),
  ];
  test('medALE is the median absolute log ratio', () => expect(medALE(rows)!).toBeCloseTo(0.2, 10));
  test('bias is the median signed log ratio', () => expect(bias(rows)!).toBeCloseTo(0.1, 10));
  test('a perfect forecast scores 0 on both', () => {
    const p = [row({ videoId: 'a', actual30: 500, est30: 500 }), row({ videoId: 'b', actual30: 9, est30: 9 })];
    expect(medALE(p)).toBe(0);
    expect(bias(p)).toBe(0);
  });
  test('non-positive or missing values are dropped, not counted as zero', () => {
    expect(medALE([...rows, row({ videoId: 'd', actual30: 0, est30: 100 })])!).toBeCloseTo(0.2, 10);
  });
});

describe('outlierStats (known answer)', () => {
  // baseline 100 everywhere; call = est30/100 >= 2, truth = actual30/100 >= 2
  const rows = [
    row({ videoId: 'tp1', est30: 300, actual30: 400 }),   // call yes, truth yes
    row({ videoId: 'tp2', est30: 250, actual30: 210 }),   // yes / yes
    row({ videoId: 'fp1', est30: 400, actual30: 100 }),   // yes / no
    row({ videoId: 'fn1', est30: 150, actual30: 500 }),   // no  / yes
    row({ videoId: 'tn1', est30: 90, actual30: 80 }),     // no  / no
  ];
  const s = outlierStats(rows);
  test('confusion matrix', () => {
    expect([s.tp, s.fp, s.fn, s.tn]).toEqual([2, 1, 1, 1]);
  });
  test('precision, recall, F1', () => {
    expect(s.precision!).toBeCloseTo(2 / 3, 10);
    expect(s.recall!).toBeCloseTo(2 / 3, 10);
    expect(s.f1!).toBeCloseTo(2 / 3, 10);
    expect(s.baseRate!).toBeCloseTo(3 / 5, 10);
  });
  test('rows without a baseline cannot carry a call', () => {
    expect(outlierStats([...rows, row({ videoId: 'x', est30: 900, actual30: 900, baseline: null, score: null })]).n).toBe(5);
  });
});

describe('spearman (known answers)', () => {
  test('monotone increasing is 1, reversed is -1', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])!).toBeCloseTo(1, 10);
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])!).toBeCloseTo(-1, 10);
  });
  test('ties get average ranks', () => {
    // x ranks 1,2.5,2.5,4 against y 1,2,3,4 -> rho = 0.9486832980505138
    expect(spearman([1, 2, 2, 3], [1, 2, 3, 4])!).toBeCloseTo(0.9486832980505138, 10);
  });
  test('null without variance or with too few pairs', () => {
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(spearman([1, 2], [1, 2])).toBeNull();
  });
  test('within-channel uses only channels at or above the minimum', () => {
    const mk = (ch: string, i: number, est: number, act: number) =>
      row({ videoId: `${ch}${i}`, channelId: ch, est30: est, actual30: act });
    const big = [1, 2, 3, 4, 5].map((i) => mk('big', i, i * 100, i * 100));
    const small = [1, 2].map((i) => mk('small', i, i * 100, (3 - i) * 100));
    const w = withinChannelSpearman([...big, ...small], 5);
    expect(w.channels).toBe(1);
    expect(w.medianRho!).toBeCloseTo(1, 10);
  });
});

describe('confidenceCalibration (known answer)', () => {
  const rows = [
    row({ videoId: 'e1', confidence: 'early', est30: 300, actual30: 400 }),   // call, hit
    row({ videoId: 'e2', confidence: 'early', est30: 300, actual30: 100 }),   // call, miss
    row({ videoId: 'e3', confidence: 'early', est30: 100, actual30: 100 }),   // no call
    row({ videoId: 'c1', confidence: 'confirmed', est30: 300, actual30: 400 }), // call, hit
    row({ videoId: 'c2', confidence: 'confirmed', est30: 300, actual30: 500 }), // call, hit
  ];
  const c = confidenceCalibration(rows);
  test('hit rate is the precision of that word\'s own calls', () => {
    expect(c.early.calls).toBe(2);
    expect(c.early.hitRate!).toBeCloseTo(0.5, 10);
    expect(c.confirmed.hitRate!).toBeCloseTo(1, 10);
  });
  test('base rate is the truth rate over all that word\'s rows', () => {
    expect(c.early.baseRate!).toBeCloseTo(1 / 3, 10);
    expect(c.confirmed.baseRate!).toBeCloseTo(1, 10);
  });
});

describe('stability (known answer)', () => {
  const ages = [3, 5];
  const at = (t: number, est: number, actual: number, pkg: BenchRow['packaging'] = []) =>
    row({ videoId: 'v', t, day: t, est30: est, actual30: actual, packaging: pkg });
  test('median churn over pairs whose truth call is unchanged', () => {
    // score 3 -> 3*e^0.4; truth 4x at both ages
    const rows = [at(3, 300, 400), at(5, 300 * Math.exp(0.4), 400)];
    expect(stability(rows, ages)['3->5'].medianChurn!).toBeCloseTo(0.4, 10);
    expect(stability(rows, ages)['3->5'].pairs).toBe(1);
  });
  test('a pair whose truth call flipped is excluded', () => {
    const rows = [
      row({ videoId: 'v', t: 3, day: 3, est30: 300, actual30: 400, baseline: 100 }),
      row({ videoId: 'v', t: 5, day: 5, est30: 600, actual30: 400, baseline: 500 }),  // truth 0.8x
    ];
    expect(stability(rows, ages)['3->5'].pairs).toBe(0);
  });
  test('a pair backed by the same underlying reading is counted, not measured', () => {
    const rows = [at(3, 300, 400), row({ videoId: 'v', t: 5, day: 3, est30: 300, actual30: 400 })];
    const s = stability(rows, ages)['3->5'];
    expect(s.pairs).toBe(0);
    expect(s.sameReading).toBe(1);
  });
  test('a pair straddled by a packaging change is excluded — the score is meant to move', () => {
    const rows = [at(3, 300, 400, [{ type: 'thumbnail_change', age: 4 }]), at(5, 900, 400, [{ type: 'thumbnail_change', age: 4 }])];
    expect(stability(rows, ages)['3->5'].pairs).toBe(0);
  });
});

describe('packaging strata', () => {
  const pkg = [{ type: 'thumbnail_change', age: 6 }];
  const before = row({ videoId: 'a', t: 3, day: 3, est30: 100, actual30: 100, packaging: pkg });
  const after = row({ videoId: 'a', t: 7, day: 7, est30: 100, actual30: 100, packaging: pkg });
  test('a change after the reading and before the truth marks the row changed', () => {
    expect(changedAfter(before)).toBe(true);
    expect(changedAfter(after)).toBe(false);   // the swap is already in the day-7 reading
  });
  test('strata partition the rows', () => {
    const rows = [before, after];
    expect(stratumRows(rows, 'pooled')).toHaveLength(2);
    expect(stratumRows(rows, 'changed')).toHaveLength(1);
    expect(stratumRows(rows, 'no_change')).toHaveLength(1);
  });
  test('a cell counts its packaging coverage classes', () => {
    const rows = [
      row({ videoId: 'a', est30: 100, actual30: 100, packagingCoverage: 'full' }),
      row({ videoId: 'b', est30: 100, actual30: 100, packagingCoverage: 'none' }),
    ];
    const c = cellFor(rows, 'heldout', 3);
    expect(c.coverage).toEqual({ full: 1, none: 1 });
  });
});

describe('packaging lift', () => {
  const lifts: LiftRow[] = [1, 2, 3, 4].map((x, i) => ({
    videoId: `v${i}`, type: 'thumbnail_change', changeAge: 5, forecastBefore: 100, actual30: 100 * x, lift: x,
  }));
  test('quantiles are linear-interpolated', () => {
    expect(quantile([1, 2, 3, 4], 0.5)!).toBeCloseTo(2.5, 10);
    expect(quantile([1, 2, 3, 4], 0.25)!).toBeCloseTo(1.75, 10);
  });
  test('summary is per type plus an all row', () => {
    const s = liftSummary(lifts);
    expect(s.map((x) => x.type)).toEqual(['thumbnail_change', 'all']);
    expect(s[0].n).toBe(4);
    expect(s[0].median!).toBeCloseTo(2.5, 10);
  });
  test('empty in, empty out', () => expect(liftSummary([])).toEqual([]));
});

describe('compare verdicts', () => {
  test('the medALE threshold is 3% of the reference, floored at 0.005', () => {
    expect(medALEThreshold(0.3)).toBeCloseTo(0.3 * MEDALE_REL, 10);
    expect(medALEThreshold(0.05)).toBeCloseTo(MEDALE_FLOOR, 10);
  });
  test('lower is better for medALE, higher for F1', () => {
    expect(verdictLower(0.20, 0.30, medALEThreshold(0.30))).toBe('better');
    expect(verdictLower(0.30, 0.20, medALEThreshold(0.20))).toBe('worse');
    expect(verdictLower(0.299, 0.30, medALEThreshold(0.30))).toBe('wash');
    expect(verdictHigher(0.80, 0.70, F1_ABS)).toBe('better');
    expect(verdictHigher(0.70, 0.80, F1_ABS)).toBe('worse');
  });
  test('a cell is worse if either metric regressed, even when the other improved', () => {
    const mk = (est: number) => [row({ videoId: 'a', est30: est, actual30: 1000, baseline: 100, score: est / 100 })];
    const opts = { modelVersion: 'x', ages: [3], splits: ['heldout'], config: {} };
    const ref = buildReport(mk(1000), opts);
    const cand = buildReport(mk(1400), opts);
    const { deltas } = compareReports(cand, ref);
    expect(deltas.find((d) => d.stratum === 'pooled')!.verdict).toBe('worse');
  });
  test('identical runs are a wash across the board', () => {
    const rows = [row({ videoId: 'a', est30: 900, actual30: 1000 }), row({ videoId: 'b', est30: 300, actual30: 250 })];
    const opts = { modelVersion: 'x', ages: [3], splits: ['heldout'], config: {} };
    const r = compareReports(buildReport(rows, opts), buildReport(rows, opts));
    expect(r.verdict).toBe('wash');
    expect(r.summary.better + r.summary.worse).toBe(0);
  });
});

describe('report rendering', () => {
  test('markdown carries every stratum and the lift table', () => {
    const rows = [row({ videoId: 'a', est30: 900, actual30: 1000 })];
    const md = reportMarkdown(buildReport(rows, { modelVersion: 'v3.0', ages: [3], splits: ['heldout'], config: {}, notes: ['n'] }));
    for (const s of ['### pooled', '### no_change', '### changed', 'Packaging-change lift', 'cov full/none']) {
      expect(md).toContain(s);
    }
  });
});
