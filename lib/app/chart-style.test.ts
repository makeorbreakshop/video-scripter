// Correction: the implied PAST and the FORECAST future were both accent-green dashed lines with
// an accent band, so a reader could not tell reconstruction from projection. This is the map
// from series kind to how it is drawn — the one place the two are made to look different.
import { seriesStyle, chartRows, bandStyle, SERIES_LABELS, BAND_LABELS, trackingBeganLabel } from './chart-style';
import type { SeriesPoint } from './chart-series';

describe('a series kind decides how it is drawn, and the kinds do not look alike', () => {
  it('draws the reconstructed past muted and dotted, with no band', () => {
    const s = seriesStyle('implied');
    expect(s.strokeToken).toBe('muted');
    expect(s.dash).toBe('2 3');       // dotted
    expect(s.band).toBe(false);
    expect(s.opacity).toBeLessThan(1);
  });

  it('draws the forecast in the accent colour, dashed, with its band', () => {
    const s = seriesStyle('forecast');
    expect(s.strokeToken).toBe('accent');
    expect(s.dash).toBe('5 4');       // dashed, not dotted
    expect(s.band).toBe(true);
  });

  it('draws the measured line solid, in the accent colour, at full weight', () => {
    const s = seriesStyle('measured');
    expect(s.strokeToken).toBe('accent');
    expect(s.dash).toBeUndefined();
    expect(s.band).toBe(false);
    expect(s.width).toBeGreaterThan(seriesStyle('implied').width);
  });

  it('gives the past and the future different strokes on every axis a reader could use', () => {
    const past = seriesStyle('implied'), future = seriesStyle('forecast');
    expect(past.strokeToken).not.toBe(future.strokeToken);
    expect(past.dash).not.toBe(future.dash);
    expect(past.band).not.toBe(future.band);
  });

  it('names the series in plain language, not model words', () => {
    expect(SERIES_LABELS.implied).toBe('before we started tracking (estimated)');
    expect(SERIES_LABELS.forecast).toBe('expected from here');
    expect(SERIES_LABELS.measured).toBe('this video');
    expect(SERIES_LABELS.expected).toBe('typical for this channel');
    for (const v of Object.values(SERIES_LABELS)) expect(v).toBe(v.toLowerCase());
  });
});

describe('the chart says when tracking began', () => {
  // Malecki XplV_L7gx6w: published Aug 29 07:12 ET, first measurement day 3.48.
  const PUB = '2026-08-29T11:12:40.000Z';

  it('labels the first measurement with its ET date', () => {
    expect(trackingBeganLabel(PUB, 3.48)).toBe('tracking began Sep 1');
  });

  it('uses ET, not UTC, for a measurement that lands late in the evening', () => {
    // 2026-09-01T03:30Z is Aug 31, 11:30 PM ET
    expect(trackingBeganLabel('2026-09-01T00:00:00.000Z', 0.1458)).toBe('tracking began Aug 31');
  });

  it('says nothing when there is nothing measured, or no publish time', () => {
    expect(trackingBeganLabel(PUB, null)).toBeNull();
    expect(trackingBeganLabel(null, 3.48)).toBeNull();
    expect(trackingBeganLabel('nonsense', 3.48)).toBeNull();
  });

  it('says nothing when tracking started at publish — there is no reconstructed past to explain', () => {
    expect(trackingBeganLabel(PUB, 0.02)).toBeNull();
  });
});

// ---------------------------------------------------------------- step 3 ----
describe('chartRows: what the plot actually feeds recharts', () => {
  const series: SeriesPoint[] = [
    { day: 0, views: 100, kind: 'implied', band: { inner: [90, 110], outer: [80, 120] } },
    { day: 1, views: 200, kind: 'measured' },
    { day: 2, views: 300, kind: 'measured' },
    { day: 3, views: 400, kind: 'forecast', band: { inner: [380, 420], outer: [350, 460] } },
    { day: 4, views: 500, kind: 'forecast', band: { inner: [460, 540], outer: [420, 600] } },
  ];
  const curve = [
    { day: 0, expected: 50, lo: 40, hi: 60 }, { day: 1, expected: 90, lo: 80, hi: 100 },
    { day: 2, expected: 150, lo: 130, hi: 170 }, { day: 3, expected: 200, lo: 180, hi: 220 },
    { day: 4, expected: 260, lo: 230, hi: 290 },
  ];

  it('emits two forecast ribbons, the q25..q75 inner sitting inside the q10..q90 outer', () => {
    const rows = chartRows(series, curve, []);
    const fc = rows.filter((r) => r.bandInner || r.bandOuter);
    expect(fc.length).toBeGreaterThanOrEqual(2);
    for (const r of fc) {
      expect(r.bandInner).toBeDefined();
      expect(r.bandOuter).toBeDefined();
      expect(r.bandInner![0]).toBeGreaterThanOrEqual(r.bandOuter![0]);
      expect(r.bandInner![1]).toBeLessThanOrEqual(r.bandOuter![1]);
    }
    // the day-4 row carries exactly the series' two ranges
    const last = rows.find((r) => r.day === 4)!;
    expect(last.bandInner).toEqual([460, 540]);
    expect(last.bandOuter).toEqual([420, 600]);
  });

  it('draws no ribbon around the reconstructed past', () => {
    const rows = chartRows(series, curve, []);
    expect(rows.find((r) => r.day === 0)!.bandInner).toBeUndefined();
    expect(rows.find((r) => r.day === 0)!.bandOuter).toBeUndefined();
  });

  it('gives one row per day, with the typical curve on the same days', () => {
    const rows = chartRows(series, curve, []);
    expect(rows.map((r) => r.day)).toEqual([0, 1, 2, 3, 4]);
    for (const r of rows) expect(r.expected).toBeGreaterThan(0);
  });

  it('joins the segments at their boundaries so the line has no hole where the kind changes', () => {
    const rows = chartRows(series, curve, []);
    const at = (d: number) => rows.find((r) => r.day === d)!;
    expect(at(0).implied).toBe(100);
    expect(at(1).implied).toBe(200);   // boundary: implied reaches into the first measured day
    expect(at(1).views).toBe(200);
    expect(at(3).views).toBe(400);     // boundary: measured reaches into the first forecast day
    expect(at(3).projected).toBe(400);
    expect(at(2).projected).toBe(300); // and back the other way
  });

  it('marks only real measurements as dots', () => {
    const rows = chartRows(series, curve, [
      { day: 1, views: 200, source: 'sample', at: '' } as any,
      { day: 9, views: 999, source: 'sample', at: '' } as any,
    ]);
    expect(rows.find((r) => r.day === 1)!.dot).toBe(200);
    expect(rows.some((r) => r.dot === 999)).toBe(false);
  });
});

describe('the band legend explains both ribbons', () => {
  it('says what the inner and outer ranges mean, in odds a reader can hold', () => {
    expect(BAND_LABELS.inner).toBe('half of videos land here');
    expect(BAND_LABELS.outer).toBe('4 in 5 land here');
    expect(bandStyle('inner').fillOpacity).toBeGreaterThan(bandStyle('outer').fillOpacity);
  });
});
