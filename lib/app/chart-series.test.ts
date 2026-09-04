import { buildSeries, channelCurve, type SeriesPoint } from './chart-series';
import { chartRows } from './chart-style';
import { expectedAt } from '../admin/video-curve';


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
      expect(p!.views).toBeGreaterThanOrEqual(0);
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
      if (!actuals.length) {
        expect(s).toEqual([]);
        continue;
      }

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

describe('forecast intervals require exact-horizon support', () => {
  it('does not fabricate a history, projection or ribbon without observations', () => {
    for (const assumeZeroOrigin of [undefined, true, false]) {
      const forecastBandAt = jest.fn();
      expect(buildSeries({ ...MALECKI, actuals: [], assumeZeroOrigin, forecastBandAt })).toEqual([]);
      expect(forecastBandAt).not.toHaveBeenCalled();
    }
  });
  it('does not substitute legacy corpus or channel residuals for a validated chart range', () => {
    const old = { ages: [1], q10: [-.4], q25: [-.2], q50: [0], q75: [.2], q90: [.4], n: [900] };
    for (const bands of [undefined, null, old]) {
      const s = buildSeries({ ...MALECKI, bands });
      expect(s.filter(p => p.kind === 'forecast').every(p => !p.band)).toBe(true);
    }
  });
  it('carries only exact horizons supported by the interval provider', () => {
    const forecastBandAt = jest.fn((views: number, day: number) => day === 30
      ? { inner: [views * .8, views * 1.2] as [number, number], outer: [views * .6, views * 1.4] as [number, number] }
      : null);
    const series = buildSeries({ ...MALECKI, forecastBandAt });
    expect(series.filter(p => p.kind === 'forecast' && p.band).map(p => p.day)).toEqual([30]);
    expect(forecastBandAt).toHaveBeenCalledWith(MALECKI.est30, 30, 5.33);
    expect(chartRows(series, [], []).filter(r => r.bandInner)).toHaveLength(1);
  });
});

describe('reconstruction respects the observed endpoints', () => {
  it('starts at assumed zero, rises monotonically, and never exceeds the first count', () => {
    const actuals = [{ day: 2.1, views: 199 }, { day: 3.1, views: 1800 }];
    const s = buildSeries({ ...MALECKI, actuals });
    const past = s.filter(p => p.day <= 2.1);
    expect(past[0].views).toBe(0);
    expect(past.at(-1)!.views).toBe(199);
    for (let i = 1; i < past.length; i++) {
      expect(past[i].views).toBeGreaterThanOrEqual(past[i - 1].views);
      expect(past[i].views).toBeLessThanOrEqual(199);
    }
  });
  it('preserves all accepted measurements including rapid growth, zero, and count corrections', () => {
    const actuals = [{ day: 0, views: 0 }, { day: .2597, views: 77993 }, { day: .2626, views: 110729 }, { day: .2729, views: 110729 }, { day: .2833, views: 144192 }, { day: .29375, views: 160000 }, { day: .325, views: 159000 }];
    const s = buildSeries({ ...MALECKI, actuals });
    for (const actual of actuals) expect(s.find(p => p.day === actual.day)).toEqual({ ...actual, kind: 'measured' });
  });
  it('does not invent an origin for live/premiere timing', () => {
    const s = buildSeries({ ...MALECKI, assumeZeroOrigin: false });
    expect(s[0]).toEqual({ ...MALECKI.actuals[0], kind: 'measured' });
  });
  it('does not move past history when later growth changes', () => {
    const first = { day: 3, views: 1000 };
    const before = buildSeries({ ...MALECKI, actuals: [first] }).filter(p => p.day < 3);
    const after = buildSeries({ ...MALECKI, actuals: [first, { day: 4, views: 100000 }] }).filter(p => p.day < 3);
    expect(after).toEqual(before);
  });
  it('bounds sparse gaps by both endpoints, including observed corrections', () => {
    for (const end of [1100, 100]) {
      const actuals = [{ day: 2, views: 1000 }, { day: 100, views: end }, { day: 101, views: 1000000 }];
      const gap = buildSeries({ ...MALECKI, actuals, horizonDay: 110 }).filter(p => p.day > 2 && p.day < 100);
      for (const p of gap) {
        expect(p.views).toBeGreaterThanOrEqual(Math.min(1000, end));
        expect(p.views).toBeLessThanOrEqual(Math.max(1000, end));
        expect(p.interpolated).toBe(true);
      }
    }
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

  it('does not attach unvalidated bands past day 30 either', () => {
    expect(buildSeries(past30).filter(p => p.kind === 'forecast').every(p => !p.band)).toBe(true);
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
