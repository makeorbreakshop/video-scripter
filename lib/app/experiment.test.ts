import { experiments, vphIn, HOUR, WINDOW_HOURS } from './experiment';
import type { Marker } from '../admin/video-curve';

const T0 = '2026-09-01T00:00:00.000Z';
const t = (h: number) => new Date(Date.parse(T0) + h * HOUR).toISOString();

// A sample every 15 minutes from `fromH` to `toH` growing at `vph` views/hour.
function ramp(fromH: number, toH: number, vph: number, start = 1000) {
  const out: { at: string; views: number }[] = [];
  for (let h = fromH; h <= toH + 1e-9; h += 0.25) out.push({ at: t(h), views: Math.round(start + (h - fromH) * vph) });
  return out;
}

function marker(over: Partial<Marker> & { day: number }): Marker {
  return {
    kind: 'thumb', at: t(over.day * 24), version: 2, fromVersion: 1, from: null, to: null, ...over,
  } as Marker;
}

describe('vphIn', () => {
  it('is the view delta over the elapsed hours between the first and last sample', () => {
    const r = vphIn(ramp(0, 4, 100), Date.parse(t(0)), Date.parse(t(4)));
    expect(r.n).toBe(17);
    expect(r.vph).toBeCloseTo(100, 0);
  });

  it('is null with fewer than two samples in the window', () => {
    expect(vphIn(ramp(0, 4, 100), Date.parse(t(0)), Date.parse(t(0.1))).vph).toBeNull();
    expect(vphIn([], 0, 1).vph).toBeNull();
  });

  it('ignores samples outside the window and treats the end bound as inclusive', () => {
    const r = vphIn(ramp(0, 10, 100), Date.parse(t(2)), Date.parse(t(4)));
    expect(r.n).toBe(9);
    expect(r.vph).toBeCloseTo(100, 0);
  });

  it('never reports a negative rate when a view count is revised down', () => {
    const s = [{ at: t(0), views: 5000 }, { at: t(1), views: 4900 }, { at: t(2), views: 4950 }];
    expect(vphIn(s, Date.parse(t(0)), Date.parse(t(2))).vph).toBe(0);
  });
});

describe('experiments', () => {
  const change = [marker({ day: 8 / 24 })]; // one thumbnail swap 8h after publish

  it('calls a big lift "helped" and reports both rates and the ratio', () => {
    const samples = [...ramp(0, 8, 100), ...ramp(8.25, 16, 300, 1801)];
    const [e] = experiments(T0, samples, change);
    expect(e.beforeVph).toBeCloseTo(100, 0);
    expect(e.afterVph!).toBeGreaterThan(280);
    expect(e.ratio!).toBeGreaterThan(2.5);
    expect(e.verdict).toBe('helped');
    expect(e.beforeSamples).toBeGreaterThanOrEqual(4);
    expect(e.afterSamples).toBeGreaterThanOrEqual(4);
  });

  it('calls a big drop "hurt"', () => {
    const samples = [...ramp(0, 8, 400), ...ramp(8.25, 16, 100, 4201)];
    const [e] = experiments(T0, samples, change);
    expect(e.verdict).toBe('hurt');
    expect(e.ratio!).toBeLessThan(0.35);
  });

  it('calls a small move "no clear effect"', () => {
    const samples = [...ramp(0, 8, 100), ...ramp(8.25, 16, 105, 1801)];
    const [e] = experiments(T0, samples, change);
    expect(e.verdict).toBe('no clear effect');
  });

  it('is "too early" when either side has fewer than four samples', () => {
    const samples = [...ramp(0, 8, 100), { at: t(8.5), views: 1900 }, { at: t(9), views: 2000 }];
    const [e] = experiments(T0, samples, change);
    expect(e.afterSamples).toBeLessThan(4);
    expect(e.verdict).toBe('too early');
  });

  it('is "too early" when a side has no measurable rate at all', () => {
    const [e] = experiments(T0, ramp(0, 8, 100), change);
    expect(e.afterVph).toBeNull();
    expect(e.verdict).toBe('too early');
  });

  it('caps each window at six hours', () => {
    const [e] = experiments(T0, ramp(0, 40, 100), [marker({ day: 20 / 24 })]);
    expect(e.windowBeforeHours).toBe(WINDOW_HOURS);
    expect(e.windowAfterHours).toBe(WINDOW_HOURS);
  });

  it('shrinks the windows to the neighbouring changes so two swaps do not share data', () => {
    const ms = [marker({ day: 2 / 24, version: 2 }), marker({ day: 4 / 24, version: 3 })];
    const [a, b] = experiments(T0, ramp(0, 20, 100), ms);
    expect(a.windowBeforeHours).toBeCloseTo(2, 6); // publish -> first change
    expect(a.windowAfterHours).toBeCloseTo(2, 6);  // first change -> second change
    expect(b.windowBeforeHours).toBeCloseTo(2, 6);
    expect(b.windowAfterHours).toBe(WINDOW_HOURS);
  });

  it('bounds a title change by the neighbouring thumbnail change too', () => {
    const ms = [marker({ day: 3 / 24, kind: 'title', version: 2 }), marker({ day: 4 / 24, kind: 'thumb', version: 2 })];
    const [title] = experiments(T0, ramp(0, 20, 100), ms);
    expect(title.kind).toBe('title');
    expect(title.windowAfterHours).toBeCloseTo(1, 6);
  });

  it('returns nothing when there are no packaging changes', () => {
    expect(experiments(T0, ramp(0, 20, 100), [])).toEqual([]);
  });

  it('keeps the marker identity so the card can line up with the chart', () => {
    const [e] = experiments(T0, ramp(0, 20, 100), [marker({ day: 8 / 24, version: 4, fromVersion: 3 })]);
    expect(e.version).toBe(4);
    expect(e.fromVersion).toBe(3);
    expect(e.day).toBeCloseTo(8 / 24, 6);
  });
});

describe('daily fallback', () => {
  const pub = '2026-08-29T16:00:00Z';
  const marker = { kind: 'thumb', version: 2, fromVersion: 1, from: null, to: null, at: '2026-09-01T16:00:00Z', day: 3 } as any;
  it('judges a change from daily snapshots when there are no launch samples', () => {
    const daily = [
      { at: '2026-08-30T12:00:00Z', views: 100000 }, { at: '2026-08-31T12:00:00Z', views: 150000 }, { at: '2026-09-01T12:00:00Z', views: 200000 },
      { at: '2026-09-02T12:00:00Z', views: 320000 }, { at: '2026-09-03T12:00:00Z', views: 440000 },
    ];
    const [e] = experiments(pub, [], [marker], Date.parse('2026-09-04T00:00:00Z'), daily);
    expect(e.resolution).toBe('daily');
    expect(e.verdict).toBe('helped');
  });
  it('stays too early with nothing on one side', () => {
    const [e] = experiments(pub, [], [marker], Date.parse('2026-09-01T18:00:00Z'), [{ at: '2026-08-30T12:00:00Z', views: 100000 }]);
    expect(e.verdict).toBe('too early');
    expect(e.resolution).toBeNull();
  });
});
