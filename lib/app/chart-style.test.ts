// Correction: the implied PAST and the FORECAST future were both accent-green dashed lines with
// an accent band, so a reader could not tell reconstruction from projection. This is the map
// from series kind to how it is drawn — the one place the two are made to look different.
import {
  seriesStyle, chartRows, bandStyle, SERIES_LABELS, BAND_LABELS, trackingBeganLabel,
  seriesStroke, TYPICAL_STYLE, trackingLabelPlacement, BAND_OPACITY_FLOOR, BAND_STYLES,
  LEGEND_ORDER, legendEntries, type ThemeMode,
} from './chart-style';
import type { SeriesPoint } from './chart-series';

describe('a series kind decides how it is drawn, and the kinds do not look alike', () => {
  it('draws the reconstructed past in the video’s own colour, dotted, with no band', () => {
    // It is this video, not the channel: the reconstruction is the same line as the measured
    // one, drawn where we are inferring it. Muted grey was the CHANNEL's colour, so the past
    // read as "typical for this channel" rather than as this video before we were watching.
    const s = seriesStyle('implied');
    expect(s.strokeToken).toBe('accent');
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

  it('gives the past and the future different strokes a reader could use', () => {
    const past = seriesStyle('implied'), future = seriesStyle('forecast');
    expect(past.dash).not.toBe(future.dash);   // dotted vs dashed
    expect(past.band).not.toBe(future.band);   // no ribbon vs two ribbons
  });

  it('never draws the reconstruction in the channel curve’s colour or dash', () => {
    // What the plot actually hands recharts: the reconstruction must not be confusable with
    // "typical for this channel", which is a plain grey dashed line.
    const C = { accent: '#0E7A3C', muted: '#5A6373' };
    expect(seriesStroke('implied', C)).toBe(C.accent);
    expect(seriesStroke('measured', C)).toBe(C.accent);
    expect(seriesStroke('forecast', C)).toBe(C.accent);
    expect(TYPICAL_STYLE.strokeToken).toBe('muted');
    expect(seriesStroke('implied', C)).not.toBe(C[TYPICAL_STYLE.strokeToken]);
    expect(seriesStyle('implied').dash).not.toBe(TYPICAL_STYLE.dash);
    // and it is drawn back from the measured line, not level with it
    expect(seriesStyle('implied').opacity).toBeLessThan(seriesStyle('measured').opacity);
  });

  it('names the series in plain language, not model words', () => {
    // The two "this video" lines say so, and say which is which.
    expect(SERIES_LABELS.implied).toBe('this video · estimated before tracking');
    expect(SERIES_LABELS.forecast).toBe('expected from here');
    expect(SERIES_LABELS.measured).toBe('this video · measured');
    expect(SERIES_LABELS.expected).toBe('typical for this channel');
    for (const v of Object.values(SERIES_LABELS)) expect(v).toBe(v.toLowerCase());
  });
});

describe('the "tracking began" label stays inside the plot, in both zooms', () => {
  // It was drawn only in the full view, so the 72h zoom — the one that shows the launch the
  // label is explaining — had a dotted stretch with nothing to say what it was.
  it('places the label at the first measurement in the 72h zoom', () => {
    const p = trackingLabelPlacement(0.26, 3)!;
    expect(p.x).toBeCloseTo(0.26, 9);
    expect(p.position).toBe('insideBottomLeft');
  });

  it('places it in the full view too', () => {
    const p = trackingLabelPlacement(0.26, 365)!;
    expect(p.x).toBeCloseTo(0.26, 9);
    expect(p.position).toBe('insideBottomLeft');
  });

  it('clamps a measurement past the right edge back inside the plot', () => {
    const p = trackingLabelPlacement(3.48, 3)!;   // Malecki, in the 72h zoom
    expect(p.x).toBeLessThanOrEqual(3);
    expect(p.x).toBeGreaterThan(0);
    expect(p.position).toBe('insideBottomRight');  // so the text runs back into the plot
  });

  it('flips the text inward once the line is near the right edge', () => {
    expect(trackingLabelPlacement(2.9, 3)!.position).toBe('insideBottomRight');
    expect(trackingLabelPlacement(1.0, 3)!.position).toBe('insideBottomLeft');
  });

  it('has nothing to place without a first measurement', () => {
    expect(trackingLabelPlacement(null, 3)).toBeNull();
    expect(trackingLabelPlacement(0.26, 0)).toBeNull();
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

  it('reads in the zone it is given, and defaults to the runtime\u2019s', () => {
    // 2026-09-01T00:00Z + 0.1458d = 03:30Z — the 31st in New York, the 1st in UTC.
    expect(trackingBeganLabel('2026-09-01T00:00:00.000Z', 0.1458, 'UTC')).toBe('tracking began Sep 1');
    expect(trackingBeganLabel('2026-09-01T00:00:00.000Z', 0.1458, 'America/Los_Angeles')).toBe('tracking began Aug 31');
    const runtime = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(trackingBeganLabel(PUB, 3.48)).toBe(trackingBeganLabel(PUB, 3.48, runtime));
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

// ------------------------------------------------- the baseline is a line ----
//
// Brandon, 2026-09-04: "I just want a baseline line, but then I want our range for the
// predictions." The channel's typical curve had a ribbon of its own, so the chart carried two
// uncertainties and the reader had to work out whose was whose. The forecast keeps the range.
describe('only the forecast carries a range', () => {
  const series: SeriesPoint[] = [
    { day: 0, views: 100, kind: 'implied', band: { inner: [90, 110], outer: [80, 120] } },
    { day: 1, views: 200, kind: 'measured' },
    { day: 2, views: 300, kind: 'forecast', band: { inner: [280, 320], outer: [250, 350] } },
  ];
  const curve = [
    { day: 0, expected: 50, lo: 40, hi: 60 },
    { day: 1, expected: 90, lo: 80, hi: 100 },
    { day: 2, expected: 150, lo: 130, hi: 170 },
  ];

  it('gives the channel’s typical curve no band field at all', () => {
    expect(TYPICAL_STYLE.band).toBe(false);
    const rows = chartRows(series, curve, []);
    for (const r of rows) {
      expect(r.expected).toBeGreaterThan(0);
      expect('band' in r).toBe(false);   // its lo/hi are never handed to the chart
    }
  });

  it('still gives the forecast its two ribbons', () => {
    const rows = chartRows(series, curve, []);
    const fc = rows.find((r) => r.day === 2)!;
    expect(fc.bandInner).toEqual([280, 320]);
    expect(fc.bandOuter).toEqual([250, 350]);
  });
});

describe('the ribbons are visible on both grounds', () => {
  const THEMES: ThemeMode[] = ['light', 'dark'];

  it('keeps every ribbon above the readable floor in each theme', () => {
    for (const theme of THEMES) {
      expect(bandStyle('inner', theme).fillOpacity).toBeGreaterThanOrEqual(BAND_OPACITY_FLOOR.inner);
      expect(bandStyle('outer', theme).fillOpacity).toBeGreaterThanOrEqual(BAND_OPACITY_FLOOR.outer);
    }
    expect(Object.keys(BAND_STYLES).sort()).toEqual(['dark', 'light']);
  });

  it('keeps the inner ribbon the darker of the two, on both grounds', () => {
    for (const theme of THEMES) {
      expect(bandStyle('inner', theme).fillOpacity).toBeGreaterThan(bandStyle('outer', theme).fillOpacity);
      expect(bandStyle('outer', theme).fillOpacity).toBeLessThan(bandStyle('inner', theme).fillOpacity / 2 + 0.05);
    }
  });

  it('paints the dark ground harder — the same alpha is not the same ribbon', () => {
    expect(bandStyle('inner', 'dark').fillOpacity).toBeGreaterThan(bandStyle('inner', 'light').fillOpacity);
    expect(bandStyle('outer', 'dark').fillOpacity).toBeGreaterThan(bandStyle('outer', 'light').fillOpacity);
  });

  it('defaults to the light values when no theme is given', () => {
    expect(bandStyle('inner')).toEqual(bandStyle('inner', 'light'));
  });
});

describe('the legend reads outward from what is known', () => {
  it('orders it measured, reconstructed, forecast, channel', () => {
    expect(LEGEND_ORDER).toEqual(['measured', 'implied', 'forecast', 'expected']);
    const all = legendEntries({ measured: true, implied: true, forecast: true, expected: true });
    expect(all.map((e) => e.label)).toEqual([
      'this video · measured',
      'this video · estimated before tracking',
      'expected from here',
      'typical for this channel',
    ]);
  });

  it('gives the swatch with the ribbon to the forecast, and to nothing else', () => {
    const all = legendEntries({ measured: true, implied: true, forecast: true, expected: true });
    expect(all.filter((e) => e.ribbon).map((e) => e.key)).toEqual(['forecast']);
  });

  it('lists only what the chart actually drew, still in order', () => {
    expect(legendEntries({ measured: true, expected: true }).map((e) => e.key)).toEqual(['measured', 'expected']);
    expect(legendEntries({})).toEqual([]);
  });
});

// ------------------------------------------------------------- chart v2 ----

import {
  BAND_DISPLAY, areaProps, SCALE_MODES, nextScale, tooltipLines, BAND_FOOTNOTE,
} from './chart-style';

describe('only the inner ribbon is drawn', () => {
  // Two ribbons put two uncertainties on one plate and the reader had to work out which was
  // which. The 10–90 range is still true and still carried — it is a line in the tooltip now.
  it('marks the outer ring as not drawn', () => {
    expect(BAND_DISPLAY.inner).toBe(true);
    expect(BAND_DISPLAY.outer).toBe(false);
  });

  it('still keeps the outer values, because the tooltip says them', () => {
    expect(BAND_STYLES.light.outer).toBeDefined();
    expect(tooltipLines({ at: '2026-09-23T22:14:00-04:00', views: 179_000, outer: [127_000, 395_000] }))
      .toContain('range 127K–395K');
  });
});

describe('the ribbon draws no dots on its edges', () => {
  // recharts puts an activeDot on every Area by default, so hovering the forecast lit up two
  // dots on the band edges — points nobody measured, drawn like measurements.
  it('disables activeDot on the band area', () => {
    const p = areaProps('inner', '#0E7A3C', 'light');
    expect(p.activeDot).toBe(false);
    expect(p.dot).toBe(false);
    expect(p.stroke).toBe('none');
    expect(p.fillOpacity).toBe(BAND_STYLES.light.inner.fillOpacity);
  });

  it('uses the dark plate’s own opacity on the dark plate', () => {
    expect(areaProps('inner', '#3FBF6F', 'dark').fillOpacity).toBe(BAND_STYLES.dark.inner.fillOpacity);
  });
});

describe('the legend’s scale toggle', () => {
  it('offers linear and log, and starts linear', () => {
    expect(SCALE_MODES).toEqual(['linear', 'log']);
    expect(SCALE_MODES[0]).toBe('linear');
  });

  it('flips between the two', () => {
    expect(nextScale('linear')).toBe('log');
    expect(nextScale('log')).toBe('linear');
  });
});

describe('the odds wording is a footnote, said once', () => {
  it('reads as one sentence under the legend', () => {
    expect(BAND_FOOTNOTE).toBe('the shaded band is where half of this channel’s videos land; the range in the tooltip is 4 in 5');
  });
});

describe('tooltipLines: four lines at the most', () => {
  const AT = '2026-09-23T22:14:00-04:00'; // 10:14 PM ET

  it('reads date, count, likely, range — and nothing else', () => {
    const lines = tooltipLines({
      at: AT, views: 179_000, typical: 88_000, inner: [148_000, 258_000], outer: [127_000, 395_000],
    });
    expect(lines).toEqual([
      'Sep 23, 10:14 PM EDT',
      '179K views · typical 88K',
      'likely 148K–258K',
      'range 127K–395K',
    ]);
  });

  it('never says more than four things', () => {
    const lines = tooltipLines({
      at: AT, views: 1, typical: 2, inner: [1, 2], outer: [1, 2],
    });
    expect(lines.length).toBeLessThanOrEqual(4);
  });

  it('drops the lines it has nothing to say on', () => {
    expect(tooltipLines({ at: AT, views: 179_000 })).toEqual(['Sep 23, 10:14 PM EDT', '179K views']);
    expect(tooltipLines({ at: AT })).toEqual(['Sep 23, 10:14 PM EDT']);
  });

  it('puts the inner range before the outer one', () => {
    const lines = tooltipLines({ at: AT, views: 10, inner: [8, 12], outer: [5, 20] });
    expect(lines.findIndex((l) => l.startsWith('likely'))).toBeLessThan(lines.findIndex((l) => l.startsWith('range')));
  });

  // The app's clock is the READER's clock, not Brandon's (lib/app/local-time.ts). The zone is
  // named once, here in the header line, so a screenshot is still unambiguous.
  it('says the time in the reader\u2019s zone, and names that zone once', () => {
    const at = '2026-09-24T02:14:00Z';
    expect(tooltipLines({ at, timeZone: 'America/New_York' })[0]).toBe('Sep 23, 10:14 PM EDT');
    expect(tooltipLines({ at, timeZone: 'America/Los_Angeles' })[0]).toBe('Sep 23, 7:14 PM PDT');
    expect(tooltipLines({ at, timeZone: 'UTC' })[0]).toBe('Sep 24, 2:14 AM UTC');
  });

  it('never writes a bare "ET" any more', () => {
    expect(tooltipLines({ at: AT, timeZone: 'UTC' })[0]).not.toMatch(/\bET\b/);
  });
});

// ------------------------------------------- the axis fits what is on screen ----
//
// kUcMWnhDF4U, 2026-09-04: an hour-old video with 1,446 views drawn on an axis whose top was
// the channel's typical curve at day 3 (148,000). The data was there; it was a flat line on the
// floor. `[0, 'auto']` fits the DATA SET, and the data set runs to the horizon.
import { visibleYDomain } from './chart-style';

describe('visibleYDomain: the y axis is set by what is in the domain, not by the horizon', () => {
  const rows = [
    { day: 0, views: 0, expected: 40 },
    { day: 0.02, views: 216, expected: 900, dot: 216 },
    { day: 0.036, views: 1446, expected: 1600, dot: 1446 },
    { day: 0.25, projected: 4000, expected: 6000, bandInner: [2600, 6200] as [number, number], bandOuter: [900, 40_000] as [number, number] },
    { day: 3, projected: 90_000, expected: 148_000, bandInner: [40_000, 200_000] as [number, number] },
  ];

  it('ignores everything past the right edge of the view', () => {
    const [lo, hi] = visibleYDomain(rows, [0, 0.25])!;
    expect(lo).toBe(0);
    expect(hi).toBeLessThan(10_000);       // not 148,000
    expect(hi).toBeGreaterThanOrEqual(6200); // but the inner band's top is still in frame
  });

  it('covers the measured line, the typical line and the drawn band', () => {
    const [, hi] = visibleYDomain(rows, [0, 0.25])!;
    expect(hi).toBeGreaterThanOrEqual(6000);
  });

  it('never lets the undrawn outer band set the scale', () => {
    const [, hi] = visibleYDomain(rows, [0, 0.25])!;
    expect(hi).toBeLessThan(40_000);
  });

  it('starts a linear axis at zero — a view axis that does not exaggerates', () => {
    expect(visibleYDomain(rows, [0, 3])![0]).toBe(0);
  });

  it('starts a log axis above zero, since a log axis cannot draw it', () => {
    const [lo] = visibleYDomain(rows, [0, 0.25], 'log')!;
    expect(lo).toBeGreaterThanOrEqual(1);
  });

  it('grows with the view: the full domain reaches the horizon values', () => {
    expect(visibleYDomain(rows, [0, 3])![1]).toBeGreaterThan(148_000);
  });

  it('is null when nothing is in view, so recharts can decide', () => {
    expect(visibleYDomain(rows, [10, 20])).toBeNull();
    expect(visibleYDomain([], [0, 3])).toBeNull();
  });
});
