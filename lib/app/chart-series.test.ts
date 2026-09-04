import { buildSeries, channelCurve, type SeriesPoint } from './chart-series';
import { chartRows } from './chart-style';
import { expectedAt } from '../admin/video-curve';
import { BAND_FACTOR_FLOOR } from '../scoring/bands';

// The fitted global params (2026-09-02): median log(v30 / v_t) per day bucket.
const MULT = { 1: 0.8688779524, 2: 0.6064517819, 3: 0.4529065479, 5: 0.3022398317, 7: 0.2243642038, 14: 0.0957340325, 21: 0.0379776014, 30: 0 };
const LONGTAIL = { ages: [60, 90, 180, 365, 730, 1500], mult: [1.08, 1.12, 1.18, 1.25, 1.3, 1.34] };

const kindsAt = (s: SeriesPoint[], lo: number, hi: number) =>
  new Set(s.filter((p) => p.day >= lo && p.day <= hi).map((p) => p.kind));

/** Malecki XplV_L7gx6w: first measurement at day 3.48, then a burst of launch samples. */
function maleckiActuals() {
  const days = [3.48, 5.002, 5.159, 5.186, 5.192, 5.199, 5.206, 5.212, 5.222, 5.228, 5.235,
    5.241, 5.248, 5.255, 5.261, 5.268, 5.282, 5.297, 5.309, 5.319, 5.33];
  const views = [816558, 977168, 985432, 986731, 987264, 987775, 988141, 988429, 988647, 989024,
    989562, 989768, 989853, 989882, 989913, 989926, 990045, 992415, 994260, 995026, 995962];
  return days.map((day, i) => ({ day, views: views[i] }));
}

const MALECKI = {
  actuals: maleckiActuals(),
  baseline: 543492.47,
  est30: 1375603.37,
  mult: MULT,
  longtail: LONGTAIL,
  horizonDay: 30,
  ageDays: 5.33,
};

describe('buildSeries — invariant 1: no gap between publish and the horizon', () => {
  it('fills days 0..first sample with implied, then measured, then forecast (20+ samples)', () => {
    const s = buildSeries(MALECKI);

    // every day before the first measurement exists and is implied
    const before = s.filter((p) => p.day < 3.48);
    expect(before.length).toBeGreaterThanOrEqual(4); // days 0,1,2,3 at least
    expect(new Set(before.map((p) => p.kind))).toEqual(new Set(['implied']));
    for (const d of [0, 1, 2, 3]) {
      const p = s.find((x) => x.day === d);
      expect(p).toBeDefined();
      expect(p!.kind).toBe('implied');
      expect(p!.views).toBeGreaterThan(0);
    }

    // the 3.48 -> 5.002 stretch is 1.5 days, inside the threshold, so it reads as measured
    expect(kindsAt(s, 3.48, 5.33)).toEqual(new Set(['measured']));

    // the measurements themselves are measured, at their own view counts
    const first = s.find((p) => p.day === 3.48)!;
    expect(first.kind).toBe('measured');
    expect(first.views).toBe(816558);
    const last = s.find((p) => p.day === 5.33)!;
    expect(last.kind).toBe('measured');
    expect(last.views).toBe(995962);

    // after the last measurement, forecast all the way to the horizon
    expect(kindsAt(s, 5.34, 30)).toEqual(new Set(['forecast']));
    expect(s[s.length - 1].day).toBeCloseTo(30, 6);
    // and it lands on est30
    expect(s[s.length - 1].views).toBeCloseTo(1375603.37, -1);
  });

  it('applies the same rule to a 3-sample video — no sparse branch', () => {
    const s = buildSeries({
      actuals: [{ day: 3.2, views: 9000 }, { day: 4.0, views: 12000 }, { day: 3.95, views: 11800 }],
      baseline: 6808.5, est30: 19001, mult: MULT, longtail: LONGTAIL, horizonDay: 30, ageDays: 4.0,
    });
    expect(kindsAt(s, 0, 3.19)).toEqual(new Set(['implied']));
    // the three samples are within 2 days of each other, so the stretch they span is measured
    expect(kindsAt(s, 3.2, 4.0)).toEqual(new Set(['measured']));
    expect(kindsAt(s, 4.01, 30)).toEqual(new Set(['forecast']));
  });

  it('joins consecutive measurements with a measured segment when they are close together', () => {
    // Two samples a day apart is a tracked stretch, not a reconstruction: the line between
    // them is measured (linear between the samples), not a hole and not implied.
    const s = buildSeries({
      actuals: [{ day: 2.4, views: 13973 }, { day: 3.4, views: 14800 }],
      baseline: 6808.5, est30: 19001, mult: MULT, longtail: LONGTAIL, horizonDay: 30, ageDays: 3.4,
    });
    const between = s.filter((p) => p.day > 2.4 && p.day < 3.4);
    expect(between.length).toBeGreaterThan(0);
    expect(new Set(between.map((p) => p.kind))).toEqual(new Set(['measured']));
    // linear between the samples: day 2.9 is halfway
    const mid = s.find((p) => p.day === 3)!;
    expect(mid.views).toBeCloseTo(13973 + (14800 - 13973) * ((3 - 2.4) / (3.4 - 2.4)), 6);
    // and no hole: every integer day from 0 to 30 exists
    for (let d = 0; d <= 30; d++) expect(s.some((p) => p.day === d)).toBe(true);
  });

  it('a gap of exactly the threshold is still measured; past it, implied', () => {
    const close = buildSeries({
      actuals: [{ day: 1, views: 100 }, { day: 3, views: 300 }],
      baseline: 200, est30: 500, mult: MULT, longtail: LONGTAIL, horizonDay: 30, ageDays: 3,
    });
    expect(close.find((p) => p.day === 2)!.kind).toBe('measured');
    const far = buildSeries({
      actuals: [{ day: 1, views: 100 }, { day: 3.5, views: 300 }],
      baseline: 200, est30: 500, mult: MULT, longtail: LONGTAIL, horizonDay: 30, ageDays: 3.5,
    });
    expect(far.find((p) => p.day === 2)!.kind).toBe('implied');
    expect(far.find((p) => p.day === 3)!.kind).toBe('implied');
  });

  it('marks the days between two measurements 6 days apart as implied', () => {
    const s = buildSeries({
      actuals: [{ day: 2, views: 1000 }, { day: 8, views: 5000 }],
      baseline: 4000, est30: 9000, mult: MULT, longtail: LONGTAIL, horizonDay: 30, ageDays: 8,
    });
    for (const d of [3, 4, 5, 6, 7]) {
      const p = s.find((x) => x.day === d)!;
      expect(p.kind).toBe('implied');
      expect(p.views).toBeGreaterThan(1000);
      expect(p.views).toBeLessThan(5000);
    }
    // the interpolation passes through both real endpoints
    expect(s.find((x) => x.day === 2)!.views).toBe(1000);
    expect(s.find((x) => x.day === 8)!.views).toBe(5000);
  });

  it('still has a value for every day with no score row at all', () => {
    const s = buildSeries({
      actuals: [{ day: 1.5, views: 400 }, { day: 2.5, views: 900 }],
      baseline: null, est30: null, mult: MULT, longtail: null, horizonDay: 30, ageDays: 2.5,
    });
    expect(s.length).toBeGreaterThan(0);
    for (const d of Array.from({ length: 31 }, (_, i) => i)) {
      const p = s.find((x) => x.day === d);
      expect(p).toBeDefined();
      expect(Number.isFinite(p!.views)).toBe(true);
    }
    expect(s.find((x) => x.day === 0)!.kind).toBe('implied');
    expect(s.find((x) => x.day === 30)!.kind).toBe('forecast');
  });

  it('property: covers every integer day 0..horizon exactly once, kinds implied* then measured/implied* then forecast*', () => {
    let seed = 1234567;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let trial = 0; trial < 200; trial++) {
      const horizonDay = Math.floor(rnd() * 200) + 1;
      const n = Math.floor(rnd() * 12);
      const ageDays = rnd() * horizonDay;
      const actuals = Array.from({ length: n }, () => ({ day: rnd() * ageDays, views: Math.floor(rnd() * 1e6) + 1 }))
        .sort((a, b) => a.day - b.day);
      const hasBaseline = rnd() > 0.3;
      const s = buildSeries({
        actuals,
        baseline: hasBaseline ? Math.floor(rnd() * 1e6) + 1000 : null,
        est30: hasBaseline ? Math.floor(rnd() * 2e6) + 1000 : null,
        mult: rnd() > 0.15 ? MULT : {},
        longtail: LONGTAIL,
        horizonDay,
        ageDays,
      });

      const days = s.map((p) => p.day);
      // sorted, unique
      expect(days).toEqual([...days].sort((a, b) => a - b));
      expect(new Set(days).size).toBe(days.length);
      // every integer day 0..horizon present
      for (let d = 0; d <= horizonDay; d++) expect(days).toContain(d);
      // every value finite and positive
      for (const p of s) expect(Number.isFinite(p.views) && p.views >= 0).toBe(true);
      // kind order: forecast is a suffix; nothing measured before the first measured day
      const firstForecast = s.findIndex((p) => p.kind === 'forecast');
      if (firstForecast >= 0) {
        expect(s.slice(firstForecast).every((p) => p.kind === 'forecast')).toBe(true);
      }
      const firstMeasured = s.findIndex((p) => p.kind === 'measured');
      if (firstMeasured >= 0) {
        expect(s.slice(0, firstMeasured).every((p) => p.kind === 'implied')).toBe(true);
      }
    }
  });

  it('band widens monotonically as the day decreases toward 0 in the implied past', () => {
    const s = buildSeries(MALECKI);
    const past = s.filter((p) => p.day < 3.48 && p.day > 0 && p.band);
    expect(past.length).toBeGreaterThanOrEqual(3);
    // uncertainty is multiplicative: read it as the log width of the band
    const widths = past.map((p) => Math.log(p.band!.outer[1] / p.band!.outer[0]));
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i - 1]).toBeGreaterThan(widths[i]); // earlier day = wider band
    }
  });
});

describe('channelCurve shares the series days', () => {
  it('samples the typical curve on exactly the days the series has, and no others', () => {
    // The chart zips both into one row per day. When the typical curve had its own log-spaced
    // grid, its extra days became rows with no series value, and recharts broke the solid
    // measured line into pieces at each of them (4 segments on GmIn1W9V8Rs).
    const s = buildSeries(MALECKI);
    const c = channelCurve(s, MALECKI.baseline, MULT, LONGTAIL);
    expect(c.map((p) => p.day)).toEqual(s.map((p) => p.day));
    for (const p of c) expect(p.expected).toBeGreaterThan(0);
  });

  it('is empty without a baseline, rather than a curve around nothing', () => {
    const s = buildSeries({ ...MALECKI, baseline: null, est30: null });
    expect(channelCurve(s, null, MULT, LONGTAIL)).toEqual([]);
  });

  it('leaves no day with a curve value but no series value, or the reverse', () => {
    const s = buildSeries(MALECKI);
    const c = channelCurve(s, MALECKI.baseline, MULT, LONGTAIL);
    const sd = new Set(s.map((p) => p.day)), cd = new Set(c.map((p) => p.day));
    expect([...cd].filter((d) => !sd.has(d))).toEqual([]);
    expect([...sd].filter((d) => !cd.has(d))).toEqual([]);
  });
});

describe('the band uses the video’s own trajectory', () => {
  const BANDS = {
    ages: [1, 4, 7], q10: [-0.4, -0.25, -0.16], q25: [-0.2, -0.14, -0.10],
    q50: [0, 0, 0], q75: [0.3, 0.23, 0.16], q90: [0.6, 0.6, 0.42], n: [900, 900, 900],
  };
  const bandOf = (s: ReturnType<typeof buildSeries>) => s[s.length - 1].band!;

  it('gives a long clean record a narrower band than a single measurement', () => {
    // ten days of samples sitting exactly where the channel curve says they should
    // exactly on the channel curve, so the fit residual is zero by construction
    const many = Array.from({ length: 12 }, (_, i) => {
      const day = 1 + i * (10 / 11);
      return { day, views: 2 * expectedAt(543492.47, MULT, day, LONGTAIL).expected };
    });
    const long = buildSeries({ ...MALECKI, actuals: many, ageDays: 11, bands: BANDS as any });
    const one = buildSeries({ ...MALECKI, actuals: [many[many.length - 1]], ageDays: 11, bands: BANDS as any });
    const w = (b: any) => Math.log(b.outer[1] / b.outer[0]);
    expect(w(bandOf(long))).toBeLessThan(w(bandOf(one)));
    // a perfect long record is tightened to exactly the floor of the single-measurement width
    expect(w(bandOf(long))).toBeCloseTo(w(bandOf(one)) * BAND_FACTOR_FLOOR, 6);
  });

  it('leaves a single measurement at the full fitted width', () => {
    const one = buildSeries({ ...MALECKI, actuals: [{ day: 4, views: 800000 }], ageDays: 4, bands: BANDS as any });
    const b = bandOf(one);
    // day 30, last measured day 4: the day-4 bucket applied whole
    expect(Math.log(b.outer[1] / b.outer[0])).toBeCloseTo(0.6 - -0.25, 6);
  });

  it('carries an inner and an outer range on every forecast point, inner inside outer', () => {
    const s = buildSeries({ ...MALECKI, bands: BANDS as any });
    const fc = s.filter((p) => p.kind === 'forecast');
    expect(fc.length).toBeGreaterThan(5);
    for (const p of fc) {
      expect(p.band).toBeDefined();
      expect(p.band!.inner[0]).toBeGreaterThanOrEqual(p.band!.outer[0] - 1e-9);
      expect(p.band!.inner[1]).toBeLessThanOrEqual(p.band!.outer[1] + 1e-9);
      expect(p.band!.outer[0]).toBeLessThanOrEqual(p.views + 1e-6);
      expect(p.band!.outer[1]).toBeGreaterThanOrEqual(p.views - 1e-6);
    }
  });

  it('draws no forecast band at all when the table is empty', () => {
    const empty = { ages: [], q10: [], q25: [], q50: [], q75: [], q90: [], n: [] };
    const s = buildSeries({ ...MALECKI, bands: empty });
    for (const p of s.filter((x) => x.kind === 'forecast')) expect(p.band).toBeUndefined();
  });

  // Regression, 2026-09-04: the ribbons were missing from the chart in BOTH zooms, and the
  // cause was here rather than in the drawing — lib/admin/queries hands `bands: null` for
  // every video today (score_params carries no `bands` key, and most channels have no
  // channel_forecast_bands rows), and null used to mean "no band at all".
  it('falls back to the corpus fit when the caller has no table — null included', () => {
    for (const bands of [undefined, null] as const) {
      const s = buildSeries({ ...MALECKI, bands });
      const fc = s.filter((p) => p.kind === 'forecast');
      expect(fc.length).toBeGreaterThan(5);
      for (const p of fc) expect(p.band).toBeDefined();
    }
  });

  // The 72h zoom draws rows with day <= 3 (video-chart-plot). A forecast day inside that
  // window must carry its band, or the ribbons vanish exactly where the launch is.
  it('bands every forecast day inside the 72h window', () => {
    const s = buildSeries({
      ...MALECKI,
      actuals: [{ day: 0.8, views: 120_000 }, { day: 1.1, views: 180_000 }],
      horizonDay: 30,
    });
    const window = s.filter((p) => p.day <= 3);
    const fc = window.filter((p) => p.kind === 'forecast');
    expect(fc.length).toBeGreaterThanOrEqual(2);   // days 2 and 3 of the integer grid
    for (const p of fc) {
      expect(p.band).toBeDefined();
      expect(p.band!.outer[0]).toBeLessThanOrEqual(p.band!.inner[0] + 1e-9);
      expect(p.band!.outer[1]).toBeGreaterThanOrEqual(p.band!.inner[1] - 1e-9);
    }
    // and the rows the plot hands recharts carry both ribbons on every one of those days
    const rows = chartRows(window, [], []).filter((r) => r.projected != null && r.day > 1.1);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of rows) { expect(r.bandInner).toBeDefined(); expect(r.bandOuter).toBeDefined(); }
  });
});

// ------------------------------------------------------- fixes of 2026-09-04 ----
//
// Two faults the BPS.space launch showed: the reconstructed past was anchored on the SINGLE
// first reading, and that reading was a stale ingest-time count. Together they scaled the whole
// implied launch to a number YouTube had cached hours earlier, and the solid measured line then
// climbed 42% in four minutes.
describe('the reconstructed past is fitted through every non-stale measurement', () => {
  const BASE = 543492.47;
  const shape = (d: number) => expectedAt(BASE, MULT, d, LONGTAIL).expected;

  /** Twenty points sitting exactly 2x the channel curve, days 3..12. */
  const onCurve = Array.from({ length: 20 }, (_, i) => {
    const day = 3 + (i * 9) / 19;
    return { day, views: 2 * shape(day) };
  });

  it('draws the implied past as the channel shape times the fitted scale', () => {
    const s = buildSeries({ actuals: onCurve, baseline: BASE, est30: null, mult: MULT, longtail: LONGTAIL, horizonDay: 30, ageDays: 12 });
    for (const d of [0.5, 1, 2]) {
      const p = s.find((x) => x.day === d)!;
      expect(p.kind).toBe('implied');
      expect(p.views / shape(d)).toBeCloseTo(2, 6);
    }
  });

  it('ignores a stale first reading instead of anchoring the whole launch on it', () => {
    // 77,993 at 20:27:58 ET, then 110,729 four minutes later: the first is a cached count.
    const stale = { day: 0.2597, views: 77_993 };
    const real = [
      { day: 0.26260, views: 110_729 },
      { day: 0.27292, views: 110_729 },
      { day: 0.28333, views: 144_192 },
      { day: 0.29375, views: 160_000 },
      { day: 0.32500, views: 202_000 },
      { day: 0.39583, views: 243_000 },
      { day: 1.26, views: 400_000 },
    ];
    const withStale = buildSeries({ actuals: [stale, ...real], baseline: BASE, est30: null, mult: MULT, longtail: LONGTAIL, horizonDay: 30, ageDays: 1.3 });
    const without = buildSeries({ actuals: real, baseline: BASE, est30: null, mult: MULT, longtail: LONGTAIL, horizonDay: 30, ageDays: 1.3 });

    // the stale reading is not part of the measured line
    expect(withStale.find((p) => p.day === stale.day)?.kind).not.toBe('measured');
    expect(withStale.find((p) => p.kind === 'measured')!.day).toBeCloseTo(0.26260, 6);
    // and the reconstruction is the same as if it had never been recorded
    for (const d of [1 / 24, 2 / 24, 4 / 24]) {
      const a = withStale.find((p) => p.day === d)!, b = without.find((p) => p.day === d)!;
      expect(a.views).toBeCloseTo(b.views, 6);
    }
    // the old behaviour: anchored on 77,993 the day-4h value would have been well below this
    const anchoredOnStale = (shape(4 / 24) / shape(stale.day)) * 77_993;
    expect(withStale.find((p) => p.day === 4 / 24)!.views).toBeGreaterThan(anchoredOnStale * 1.1);
  });

  it('joins the measured line exactly: the implied value at the first measurement is that measurement', () => {
    // A video found late (first measurement on day 100), whose record sits well ABOVE the
    // fitted scale at that first point — so the fit and the anchor genuinely disagree and the
    // blend has work to do. The last tenth of the span in log(day+1) is days ~63..100.
    const acts = [
      { day: 100, views: 3 * shape(100) },
      { day: 140, views: 1.5 * shape(140) },
      { day: 200, views: 1.2 * shape(200) },
    ];
    const s = buildSeries({ actuals: acts, baseline: BASE, est30: null, mult: MULT, longtail: LONGTAIL, horizonDay: 365, ageDays: 200 });
    const anchoredAt = (d: number) => (shape(d) / shape(100)) * 3 * shape(100);
    // continuity: by the last drawn day before the join the implied path IS the anchored path
    const join = s.find((p) => p.day === 99)!;
    expect(join.kind).toBe('implied');
    expect(join.views / anchoredAt(99)).toBeCloseTo(1, 1); // within ~1.3%
    // and the series value AT the first measurement is that measurement, exactly
    expect(s.find((p) => p.day === 100)!.views).toBeCloseTo(3 * shape(100), 6);
    // the blend only moves one way: it closes monotonically as the join approaches
    const gaps = [70, 80, 90, 99].map((d) => Math.abs(Math.log(s.find((p) => p.day === d)!.views / anchoredAt(d))));
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeLessThan(gaps[i - 1]);
    // the far past follows the fitted scale, not the first point's anchor
    expect(s.find((p) => p.day === 0)!.views).toBeLessThan(anchoredAt(0));
    expect(s.find((p) => p.day === 10)!.views / shape(10)).toBeCloseTo(
      s.find((p) => p.day === 20)!.views / shape(20), 6);
  });

  it('lets a launch burst not outvote a daily record in the fit (span weighting)', () => {
    // one daily point at 2x, twenty samples inside ten minutes of day 5 at 2x as well:
    // the fit is 2x either way, but with per-point weights the burst would dominate.
    const burst = Array.from({ length: 20 }, (_, i) => {
      const day = 5 + i / (24 * 6 * 20);
      return { day, views: 2 * shape(day) };
    });
    const s = buildSeries({ actuals: [{ day: 1, views: 2 * shape(1) }, ...burst], baseline: BASE, est30: null, mult: MULT, longtail: LONGTAIL, horizonDay: 30, ageDays: 5.1 });
    expect(s.find((p) => p.day === 0.5)!.views / shape(0.5)).toBeCloseTo(2, 6);
  });
});

// ------------------------------------------------- chart v2: one continuous view ----

import { horizonFor } from './chart-horizon';
import { longtailAt } from '../admin/video-curve';

describe('the series covers the whole data-driven horizon, and keeps going past day 30', () => {
  // A twelve-day video: 3 × age is 36, which rounds to the 30-day tick.
  const twelveDays = {
    actuals: Array.from({ length: 12 }, (_, i) => ({ day: i + 1, views: 100_000 * (i + 1) })),
    baseline: 800_000, est30: 1_600_000, mult: MULT, longtail: LONGTAIL,
    horizonDay: horizonFor(12), ageDays: 12,
  };

  it('reaches the horizon the age asked for, with no day missing on the way', () => {
    const s = buildSeries(twelveDays);
    expect(twelveDays.horizonDay).toBe(30);
    expect(Math.max(...s.map((p) => p.day))).toBe(30);
    for (let d = 0; d <= 30; d++) expect(s.some((p) => p.day === d)).toBe(true);
  });

  const past30 = { ...twelveDays, horizonDay: horizonFor(60), ageDays: 60,
    actuals: Array.from({ length: 20 }, (_, i) => ({ day: i + 1, views: 100_000 * (i + 1) })) };

  it('draws every day out to a 180-day horizon', () => {
    expect(past30.horizonDay).toBe(180);
    const s = buildSeries(past30);
    expect(Math.max(...s.map((p) => p.day))).toBe(180);
    expect(s.filter((p) => p.day > 30 && p.kind === 'forecast').length).toBeGreaterThan(100);
  });

  it('continues past day 30 on the fitted long-tail curve, not flat', () => {
    const s = buildSeries(past30);
    const at = (d: number) => s.find((p) => p.day === d)!;
    expect(at(30).views).toBeCloseTo(past30.est30, 0);
    // Each later day is the day-30 estimate times the fitted long tail at that age.
    for (const d of [60, 90, 180]) {
      expect(at(d).views).toBeCloseTo(past30.est30 * longtailAt(LONGTAIL, d), 0);
      expect(at(d).views).toBeGreaterThan(at(30).views);
    }
    expect(at(180).views).toBeGreaterThan(at(90).views);
  });

  it('keeps the day-30 estimate as a point ON the median, not a separate line', () => {
    const s = buildSeries(past30);
    const d30 = s.find((p) => p.day === 30)!;
    expect(d30.kind).toBe('forecast');
    expect(d30.views).toBeCloseTo(past30.est30, 0);
  });

  it('carries both rings on every forecast point — the outer is data, even undrawn', () => {
    const s = buildSeries(past30).filter((p) => p.kind === 'forecast' && p.day > 25);
    expect(s.length).toBeGreaterThan(0);
    for (const p of s) {
      expect(p.band!.inner[0]).toBeLessThanOrEqual(p.band!.inner[1]);
      expect(p.band!.outer[0]).toBeLessThanOrEqual(p.band!.inner[0]);
      expect(p.band!.outer[1]).toBeGreaterThanOrEqual(p.band!.inner[1]);
    }
  });

  it('hands the outer ring to the rows so the tooltip can read it, drawn or not', () => {
    const rows = chartRows(buildSeries(past30), [], []).filter((r) => r.bandInner);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => !!r.bandOuter)).toBe(true);
  });
});

// --------------------------------------------- the launch window is the whole chart ----
//
// A video an hour old is drawn to a SIX HOUR horizon now (lib/app/chart-horizon.ts). The grid
// that was enough when the narrowest chart was three days — hours 1, 2, 4, 8, 12, 18 — puts one
// point inside a six-hour domain, which is not a line.
import { seriesDays as launchDays, FINE_STEP_DAYS } from './chart-series';

describe('seriesDays on a sub-day domain', () => {
  it('samples every quarter hour across a six-hour horizon', () => {
    const days = launchDays(6 / 24, []);
    const inside = days.filter((d) => d > 0 && d <= 6 / 24);
    expect(inside.length).toBeGreaterThanOrEqual(24);
    // no gap wider than a quarter hour anywhere in the domain
    for (let i = 1; i < days.length; i++) expect(days[i] - days[i - 1]).toBeLessThanOrEqual(FINE_STEP_DAYS + 1e-9);
  });

  it('still starts at publish and ends exactly on the horizon', () => {
    const days = launchDays(6 / 24, []);
    expect(days[0]).toBe(0);
    expect(days[days.length - 1]).toBeCloseTo(6 / 24, 9);
  });

  it('keeps the real measurements, whatever minute they landed on', () => {
    const days = launchDays(6 / 24, [7 / 1440, 52 / 1440]);
    expect(days).toContain(7 / 1440);
    expect(days).toContain(52 / 1440);
  });

  it('leaves a multi-day domain on the day grid it already had', () => {
    const days = launchDays(3, []);
    expect(days.filter((d) => d > 0 && d < 1).length).toBeLessThan(10);
    expect(days).toContain(1);
    expect(days).toContain(3);
  });
});
