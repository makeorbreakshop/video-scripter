import { buildSeries, type SeriesPoint } from './chart-series';

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
    expect(s.find((p) => p.day === 3.2)!.kind).toBe('measured');
    expect(s.find((p) => p.day === 4.0)!.kind).toBe('measured');
    expect(kindsAt(s, 4.01, 30)).toEqual(new Set(['forecast']));
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
    const widths = past.map((p) => Math.log(p.band![1] / p.band![0]));
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i - 1]).toBeGreaterThan(widths[i]); // earlier day = wider band
    }
  });
});
