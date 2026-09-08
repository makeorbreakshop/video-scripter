import {
  benchmarkGate, stabilityGate, calibrationGate, estimateGate, decide, cellRegression,
  relThreshold, STABILITY_ABS, type CellDeltaInput, type GateSet,
} from './refit-gates';

const cell = (o: Partial<CellDeltaInput>): CellDeltaInput => ({
  split: 'time', stratum: 'pooled', t: 1, medALECand: 0.3, medALERef: 0.3,
  f1Cand: 0.7, f1Ref: 0.7, verdict: 'wash', ...o,
});

describe('relThreshold', () => {
  it('is 3% of the reference once that beats the floor', () => {
    expect(relThreshold(0.5)).toBeCloseTo(0.015);
  });
  it('never drops below the 0.005 floor, so a tiny reference cannot make any change a regression', () => {
    expect(relThreshold(0.01)).toBe(0.005);
    expect(relThreshold(null)).toBe(0.005);
  });
});

describe('cellRegression', () => {
  it('is zero inside the threshold', () => {
    expect(cellRegression(cell({ medALECand: 0.309, medALERef: 0.3 }))).toBe(0);
  });
  it('counts a medALE rise past the threshold, in units of it', () => {
    // ref .3 -> threshold .009; cand .318 is .009 over.
    expect(cellRegression(cell({ medALECand: 0.318, medALERef: 0.3 }))).toBeCloseTo(1);
  });
  it('counts an F1 drop past 0.03', () => {
    expect(cellRegression(cell({ f1Cand: 0.6, f1Ref: 0.7 }))).toBeCloseTo((0.1 - 0.03) / 0.03);
  });
  it('ignores a null cell rather than treating it as a regression', () => {
    expect(cellRegression(cell({ medALECand: null, f1Cand: null }))).toBe(0);
  });
});

describe('benchmarkGate', () => {
  it('passes when nothing regressed', () => {
    const g = benchmarkGate([cell({ verdict: 'better' }), cell({ t: 2 })]);
    expect(g.status).toBe('pass');
    expect(g.detail.worstCell).toBeNull();
  });

  it('fails on one worse cell and names it', () => {
    const g = benchmarkGate([cell({ t: 7 }), cell({ t: 2, medALECand: 0.4, medALERef: 0.3, verdict: 'worse' })]);
    expect(g.status).toBe('fail');
    expect(g.detail.worstCell).toBe('time/pooled/t=2');
  });

  it('names the no_change cell, not the pooled one, when both regressed at the same age', () => {
    // Packaging coverage starts 2026-09-01, so pooled quietly contains unseen swaps and
    // no_change is the honest stratum. The worst cell a human reads must be the honest one.
    const g = benchmarkGate([
      cell({ t: 3, stratum: 'pooled', medALECand: 0.9, medALERef: 0.3, verdict: 'worse' }),
      cell({ t: 3, stratum: 'no_change', medALECand: 0.4, medALERef: 0.3, verdict: 'worse' }),
    ]);
    expect(g.status).toBe('fail');
    expect(g.detail.worstCell).toBe('time/no_change/t=3');
  });

  it('is inconclusive, not a pass, when the compare produced no cells', () => {
    expect(benchmarkGate([]).status).toBe('inconclusive');
    expect(benchmarkGate(null).status).toBe('inconclusive');
  });
});

describe('stabilityGate', () => {
  it('passes when churn barely moves', () => {
    expect(stabilityGate([{ split: 'time', pair: '1->2', candChurn: 0.21, refChurn: 0.203 }]).status).toBe('pass');
  });
  it('fails when a row gets noticeably churnier', () => {
    const g = stabilityGate([{ split: 'time', pair: '1->2', candChurn: 0.25, refChurn: 0.2 }]);
    expect(g.status).toBe('fail');
    expect(g.detail.worstRow).toBe('time/1->2');
  });
  it('does not fail on a row that got calmer', () => {
    expect(stabilityGate([{ split: 'heldout', pair: '2->3', candChurn: 0.1, refChurn: 0.9 }]).status).toBe('pass');
  });
  it('is inconclusive with nothing comparable', () => {
    expect(stabilityGate([{ split: 'time', pair: '1->2', candChurn: null, refChurn: 0.2 }]).status).toBe('inconclusive');
  });
  it('uses the documented 0.03 margin', () => {
    expect(STABILITY_ABS).toBe(0.03);
  });
});

describe('calibrationGate', () => {
  it('passes the 2026-09-08 numbers', () => {
    expect(calibrationGate({ inner: 50.2, outer: 79.5, n: 1511 }).status).toBe('pass');
  });
  it('fails a ribbon that claims half and delivers a third', () => {
    expect(calibrationGate({ inner: 33, outer: 79, n: 1511 }).status).toBe('fail');
  });
  it('fails an outer ribbon that is too wide as well as too narrow', () => {
    expect(calibrationGate({ inner: 50, outer: 92, n: 900 }).status).toBe('fail');
  });
  it('is inconclusive when the check did not run', () => {
    expect(calibrationGate(null).status).toBe('inconclusive');
  });
});

describe('estimateGate', () => {
  const REF = 0.1834; // the recorded v5.3 >3d result
  it('passes an equal result', () => {
    expect(estimateGate({ medALE: 0.1834, bias: -0.1, n: 3947, refMedALE: REF }).status).toBe('pass');
  });
  it('allows drift up to 3% of the reference', () => {
    expect(estimateGate({ medALE: 0.1834 + 0.0054, bias: null, n: 3947, refMedALE: REF }).status).toBe('pass');
    expect(estimateGate({ medALE: 0.1834 + 0.006, bias: null, n: 3947, refMedALE: REF }).status).toBe('fail');
  });
  it('is inconclusive without a reference, rather than passing on nothing', () => {
    expect(estimateGate({ medALE: 0.1, bias: null, n: 10, refMedALE: null }).status).toBe('inconclusive');
  });
});

describe('decide', () => {
  const pass = { status: 'pass' as const, headline: 'ok', detail: {} };
  const set = (o: Partial<GateSet>): GateSet =>
    ({ benchmark: pass, stability: pass, calibration: pass, estimate: pass, ...o });

  it('promotes only when all four gates pass', () => {
    const d = decide(set({}));
    expect(d.verdict).toBe('promoted');
    expect(d.failed).toEqual([]);
  });

  it('rejects on any single failure and says which', () => {
    const d = decide(set({ calibration: { status: 'fail', headline: 'inner 33.0%', detail: {} } }));
    expect(d.verdict).toBe('rejected');
    expect(d.failed).toEqual(['calibration']);
    expect(d.notes).toContain('inner 33.0%');
  });

  it('rejects on an inconclusive gate — absent evidence is not a pass', () => {
    expect(decide(set({ estimate: { status: 'inconclusive', headline: 'no run', detail: {} } })).verdict)
      .toBe('rejected');
  });

  it('lists failures with the estimate gate first, because it is the only one that sees v5.3', () => {
    const fail = { status: 'fail' as const, headline: 'x', detail: {} };
    expect(decide(set({ benchmark: fail, estimate: fail })).failed).toEqual(['estimate', 'benchmark']);
  });

  it('carries the benchmark worst cell onto the verdict', () => {
    const d = decide(set({ benchmark: { status: 'fail', headline: 'x', detail: { worstCell: 'time/no_change/t=3' } } }));
    expect(d.worstCell).toBe('time/no_change/t=3');
  });
});
