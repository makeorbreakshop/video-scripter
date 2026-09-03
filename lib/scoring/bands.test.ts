// The forecast band: how wrong the day-30 forecast has actually been, by the age of the last
// measurement. Replaces a hand-picked constant (chart-series FORECAST_SIGMA_PER_LOGDAY = 0.30,
// a flat 3.00x spread at day 30 for a video last measured on day 4).
import { fitBands, quantile, bandAt, forecastBand, BAND_AGES, FITTED_BANDS_2026_09_03, type BandTable } from './bands';

// A fixture table: wide when we last saw the video early, tight when we saw it late.
const T: BandTable = {
  ages: [1, 2, 4, 7, 14],
  q10: [-0.50, -0.40, -0.25, -0.15, -0.05],
  q50: [0, 0, 0, 0, 0],
  q90: [0.55, 0.42, 0.26, 0.16, 0.06],
  n: [900, 900, 900, 900, 900],
};

describe('quantile', () => {
  it('interpolates between the two nearest order statistics', () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBeCloseTo(3, 9);
    expect(quantile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 9);
    expect(quantile([0, 10], 0.1)).toBeCloseTo(1, 9);
    expect(quantile([], 0.5)).toBeNull();
  });
});

describe('forecastBand', () => {
  it('has zero width at the last measurement', () => {
    const [lo, hi] = forecastBand(15465, 3.955, 3.955, T);
    expect(hi - lo).toBeCloseTo(0, 6);
    expect(lo).toBeCloseTo(15465, 6);
  });

  it('at day 30 is exactly est30 * exp(q10) .. est30 * exp(q90) for the last-measurement bucket', () => {
    const est30 = 19001;
    const [lo, hi] = forecastBand(est30, 30, 4, T);
    expect(lo).toBeCloseTo(est30 * Math.exp(-0.25), 6);
    expect(hi).toBeCloseTo(est30 * Math.exp(0.26), 6);
  });

  it('is narrower at day 30 the later the video was last measured', () => {
    const widths = [1, 2, 4, 7, 14].map((age) => {
      const [lo, hi] = forecastBand(19001, 30, age, T);
      return hi - lo;
    });
    for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeLessThan(widths[i - 1]);
  });

  it('keeps the drawn line inside the band everywhere', () => {
    for (const age of [0.5, 1, 2.5, 4, 9, 14, 25]) {
      for (const day of [age, age + 0.1, 3, 7, 15, 29.9, 30, 45, 90]) {
        if (day < age) continue;
        const views = 10000 + day * 100; // stand-in for the drawn forecast value
        const [lo, hi] = forecastBand(views, day, age, T);
        expect(lo).toBeLessThanOrEqual(views + 1e-9);
        expect(hi).toBeGreaterThanOrEqual(views - 1e-9);
      }
    }
  });

  it('widens monotonically with the day, for a fixed last measurement', () => {
    let prev = -1;
    for (const day of [4, 5, 7, 10, 14, 21, 30]) {
      const [lo, hi] = forecastBand(19001, day, 4, T);
      const w = Math.log(hi / lo);
      expect(w).toBeGreaterThanOrEqual(prev);
      prev = w;
    }
  });

  it('falls back to no band at all when there is no fitted table', () => {
    expect(forecastBand(19001, 30, 4, null)).toBeNull();
  });

  it('interpolates between fitted buckets and clamps outside them', () => {
    const b3 = bandAt(T, 3);
    expect(b3.q90).toBeLessThan(0.42);
    expect(b3.q90).toBeGreaterThan(0.26);
    expect(bandAt(T, 0.1).q90).toBeCloseTo(0.55, 9); // clamped to the first bucket
    expect(bandAt(T, 40).q90).toBeCloseTo(0.06, 9);  // clamped to the last
  });
});

describe('fitBands', () => {
  // resid = log(actual day-30 views / the day-30 forecast made at that age)
  const rows = (age: number, spread: number, n = 400) =>
    Array.from({ length: n }, (_, i) => ({ age, resid: ((i / (n - 1)) - 0.5) * 2 * spread }));

  it('takes the 10th/50th/90th percentile of the log residual per age bucket', () => {
    const t = fitBands([...rows(1, 1), ...rows(7, 0.2)], [1, 7], 50);
    expect(t.q50[0]).toBeCloseTo(0, 2);
    expect(t.q90[0]).toBeCloseTo(0.8, 2);
    expect(t.q10[0]).toBeCloseTo(-0.8, 2);
    expect(t.q90[1]).toBeCloseTo(0.16, 2);
  });

  it('forces the band to contain the forecast — q10 <= 0 <= q90', () => {
    const skewed = Array.from({ length: 200 }, () => ({ age: 1, resid: 0.9 }));
    const t = fitBands(skewed, [1], 50);
    expect(t.q10[0]).toBeLessThanOrEqual(0);
    expect(t.q90[0]).toBeGreaterThanOrEqual(0);
  });

  it('forces the width to shrink with age, so a later measurement is never less certain', () => {
    // a noisy day-7 bucket that came out wider than day 1
    const t = fitBands([...rows(1, 0.2), ...rows(7, 1)], [1, 7], 50);
    const width = (i: number) => Math.exp(t.q90[i]) - Math.exp(t.q10[i]);
    expect(width(1)).toBeLessThanOrEqual(width(0) + 1e-9);
  });

  it('carries a thin bucket forward rather than inventing a percentile from ten videos', () => {
    const t = fitBands([...rows(1, 1), ...rows(7, 0.2, 5)], [1, 7], 50);
    expect(t.n[1]).toBe(5);
    expect(t.q90[1]).toBeCloseTo(t.q90[0], 9);
  });

  it('declares the ages it fits', () => {
    expect(BAND_AGES).toEqual([0.5, 1, 2, 3, 4, 5, 7, 10, 14, 21]);
  });
});

// Sanity on the fitted params themselves, not on the drawing code.
describe('the fitted table, read as a claim about the model', () => {
  const T = FITTED_BANDS_2026_09_03;
  const spread = (age: number) => {
    const i = T.ages.indexOf(age);
    return Math.exp(T.q90[i]) - Math.exp(T.q10[i]);
  };

  it('reports what the day-4 10-90 range at day 30 actually is', () => {
    // The review asked for under 1.0. The corpus says 1.035 (0.78x .. 1.82x of the forecast),
    // so this pins the real number rather than a wish. It is a third of the 3.00x flat band
    // it replaces.
    expect(spread(4)).toBeCloseTo(1.035, 3);
    expect(spread(4)).toBeLessThan(1.10);
    expect(spread(4)).toBeLessThan(spread(1) / 2);
  });

  it('narrows all the way down the age ladder', () => {
    for (let i = 1; i < T.ages.length; i++) expect(spread(T.ages[i])).toBeLessThan(spread(T.ages[i - 1]));
    expect(spread(21)).toBeLessThan(0.2);
  });

  it('is unbiased from day 2 on, and contains its own forecast at every age', () => {
    for (let i = 0; i < T.ages.length; i++) {
      expect(T.q10[i]).toBeLessThanOrEqual(0);
      expect(T.q90[i]).toBeGreaterThanOrEqual(0);
      if (T.ages[i] >= 2) expect(Math.abs(T.q50[i])).toBeLessThan(0.02);
    }
  });

  it('is far tighter than the hand-picked constant it replaces', () => {
    // old: sigma = 0.30 * (ln(31) - ln(4.955)) = 0.5501 -> exp(2*sigma) = 3.00x, at every age
    const old = Math.exp(2 * 0.30 * (Math.log(31) - Math.log(4.955)));
    const [lo, hi] = forecastBand(19001, 30, 3.955, T)!;
    expect(old).toBeCloseTo(3.0, 1);
    expect(hi / lo).toBeLessThan(old);
    expect(Math.round(lo)).toBe(14821);
    expect(Math.round(hi)).toBe(34748);
    expect(hi / lo).toBeCloseTo(2.34, 2); // 3.00x -> 2.34x for this video
  });
});
