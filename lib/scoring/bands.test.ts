// The forecast band: how wrong the day-30 forecast has actually been, by the age of the last
// measurement. Replaces a hand-picked constant (chart-series FORECAST_SIGMA_PER_LOGDAY = 0.30,
// a flat 3.00x spread at day 30 for a video last measured on day 4).
import {
  fitBands, quantile, bandAt, forecastBand, shrinkToGlobal, trajectoryFactor, fitTrajectory,
  BAND_AGES, SHRINK_K, shrinkKFor, QUANTILE_KEYS, MIN_CHANNEL_BUCKET_N, BAND_FACTOR_FLOOR,
  FITTED_BANDS_2026_09_03, heldOut, type BandTable,
} from './bands';

// A fixture table: wide when we last saw the video early, tight when we saw it late.
const T: BandTable = {
  ages: [1, 2, 4, 7, 14],
  q10: [-0.50, -0.40, -0.25, -0.15, -0.05],
  q25: [-0.25, -0.20, -0.13, -0.08, -0.03],
  q50: [0, 0, 0, 0, 0],
  q75: [0.28, 0.21, 0.13, 0.08, 0.03],
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
    const b = forecastBand(15465, 3.955, 3.955, T)!;
    expect(b.outer[1] - b.outer[0]).toBeCloseTo(0, 6);
    expect(b.outer[0]).toBeCloseTo(15465, 6);
  });

  it('at day 30 is exactly est30 * exp(q10) .. est30 * exp(q90) for the last-measurement bucket', () => {
    const est30 = 19001;
    const b = forecastBand(est30, 30, 4, T)!;
    expect(b.outer[0]).toBeCloseTo(est30 * Math.exp(-0.25), 6);
    expect(b.outer[1]).toBeCloseTo(est30 * Math.exp(0.26), 6);
    expect(b.inner[0]).toBeCloseTo(est30 * Math.exp(-0.13), 6);
    expect(b.inner[1]).toBeCloseTo(est30 * Math.exp(0.13), 6);
  });

  it('is narrower at day 30 the later the video was last measured', () => {
    for (const key of ['inner', 'outer'] as const) {
      const widths = [1, 2, 4, 7, 14].map((age) => {
        const b = forecastBand(19001, 30, age, T)!;
        return b[key][1] - b[key][0];
      });
      for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeLessThan(widths[i - 1]);
    }
  });

  it('keeps the drawn line inside the band everywhere', () => {
    for (const age of [0.5, 1, 2.5, 4, 9, 14, 25]) {
      for (const day of [age, age + 0.1, 3, 7, 15, 29.9, 30, 45, 90]) {
        if (day < age) continue;
        const views = 10000 + day * 100; // stand-in for the drawn forecast value
        const b = forecastBand(views, day, age, T)!;
        for (const key of ['inner', 'outer'] as const) {
          expect(b[key][0]).toBeLessThanOrEqual(views + 1e-9);
          expect(b[key][1]).toBeGreaterThanOrEqual(views - 1e-9);
        }
      }
    }
  });

  it('widens monotonically with the day, for a fixed last measurement', () => {
    let prev = -1;
    for (const day of [4, 5, 7, 10, 14, 21, 30]) {
      const b = forecastBand(19001, day, 4, T)!;
      const w = Math.log(b.outer[1] / b.outer[0]);
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
    // The review asked for under 1.0. The corpus says 1.047 (0.78x .. 1.83x of the forecast),
    // so this pins the real number rather than a wish. It is a third of the 3.00x flat band
    // it replaces, and the INNER (q25..q75) range — what the chart draws solid — is 0.389.
    expect(spread(4)).toBeCloseTo(1.047, 3);
    expect(spread(4)).toBeLessThan(1.10);
    expect(spread(4)).toBeLessThan(spread(1) / 2);
    const i = T.ages.indexOf(4);
    expect(Math.exp(T.q75[i]) - Math.exp(T.q25[i])).toBeCloseTo(0.389, 3);
  });

  it('narrows all the way down the age ladder', () => {
    for (let i = 1; i < T.ages.length; i++) expect(spread(T.ages[i])).toBeLessThan(spread(T.ages[i - 1]));
    expect(spread(21)).toBeLessThan(0.2);
  });

  it('is unbiased from day 2 on, and contains its own forecast at every age', () => {
    for (let i = 0; i < T.ages.length; i++) {
      expect(T.q10[i]).toBeLessThanOrEqual(0);
      expect(T.q90[i]).toBeGreaterThanOrEqual(0);
      expect(T.q25[i]).toBeLessThanOrEqual(0);
      expect(T.q75[i]).toBeGreaterThanOrEqual(0);
      if (T.ages[i] >= 2) expect(Math.abs(T.q50[i])).toBeLessThan(0.02);
    }
  });

  it('is far tighter than the hand-picked constant it replaces', () => {
    // old: sigma = 0.30 * (ln(31) - ln(4.955)) = 0.5501 -> exp(2*sigma) = 3.00x, at every age
    const old = Math.exp(2 * 0.30 * (Math.log(31) - Math.log(4.955)));
    const b = forecastBand(19001, 30, 3.955, T)!;
    const [lo, hi] = b.outer;
    expect(old).toBeCloseTo(3.0, 1);
    expect(hi / lo).toBeLessThan(old);
  });
});

// ---------------------------------------------------------------- step 1 ----
// Conditioning on the channel: a channel that lands where the model says it will should get a
// narrower band than the corpus average, and one we have barely seen should get the corpus's.
describe('shrinkToGlobal', () => {
  const G: BandTable = {
    ages: [1, 4], q10: [-0.40, -0.20], q25: [-0.20, -0.10], q50: [0, 0],
    q75: [0.30, 0.15], q90: [0.60, 0.30], n: [1000, 1000],
  };
  const tight: BandTable = {
    ages: [1, 4], q10: [-0.10, -0.04], q25: [-0.05, -0.02], q50: [0, 0],
    q75: [0.05, 0.02], q90: [0.10, 0.04], n: [0, 0],
  };
  const width = (t: BandTable, i: number) => Math.exp(t.q90[i]) - Math.exp(t.q10[i]);

  it('a channel with tight residuals ends up narrower than global', () => {
    const s = shrinkToGlobal({ ...tight, n: [200, 200] }, G);
    expect(width(s, 0)).toBeLessThan(width(G, 0));
    expect(width(s, 1)).toBeLessThan(width(G, 1));
  });

  it('n = 0 reproduces global exactly', () => {
    const s = shrinkToGlobal({ ...tight, n: [0, 0] }, G);
    for (let i = 0; i < G.ages.length; i++) {
      for (const k of ['q10', 'q25', 'q50', 'q75', 'q90'] as const) expect(s[k][i]).toBeCloseTo(G[k][i], 12);
    }
  });

  it('very large n reproduces the channel quantiles', () => {
    const s = shrinkToGlobal({ ...tight, n: [1e6, 1e6] }, G);
    for (let i = 0; i < G.ages.length; i++) {
      for (const k of ['q10', 'q25', 'q50', 'q75', 'q90'] as const) expect(s[k][i]).toBeCloseTo(tight[k][i], 4);
    }
  });

  it('moves monotonically from global toward the channel as n grows', () => {
    for (const key of QUANTILE_KEYS) {
      const at = (n: number) => shrinkToGlobal({ ...tight, n: [n, n] }, G, SHRINK_K, 0)[key][0];
      const seq = [0, 1, 2, 4, 8, 16, 64, 256, 4096].map(at);
      for (let i = 1; i < seq.length; i++) {
        expect(Math.abs(seq[i] - tight[key][0])).toBeLessThanOrEqual(Math.abs(seq[i - 1] - tight[key][0]) + 1e-12);
      }
      expect(seq[0]).toBeCloseTo(G[key][0], 12);
    }
  });

  it('weighs the median at w = n/(n+8), exactly as specified', () => {
    expect(SHRINK_K).toBe(8);
    const at = (n: number) => shrinkToGlobal({ ...tight, n: [n, n] }, { ...G, q50: [0.4, 0.4] }, SHRINK_K, 0).q50[0];
    expect(at(8)).toBeCloseTo((0.4 + tight.q50[0]) / 2, 12);
  });

  it('shrinks a tail quantile harder than the median, because a tail needs more data to see', () => {
    // Var of a sample p-quantile goes as p(1-p): the 90th percentile of five videos is just
    // their maximum. Held-out calibration proved this — a flat w = n/(n+8) on q10/q90 gave a
    // "4 in 5" band that covered 38.7%. k is scaled by 0.25 / p(1-p).
    expect(shrinkKFor('q50')).toBeCloseTo(8, 9);
    expect(shrinkKFor('q25')).toBeCloseTo(8 * 0.25 / 0.1875, 9);
    expect(shrinkKFor('q75')).toBeCloseTo(shrinkKFor('q25'), 9);
    expect(shrinkKFor('q10')).toBeCloseTo(8 * 0.25 / 0.09, 9);
    expect(shrinkKFor('q90')).toBeCloseTo(shrinkKFor('q10'), 9);
    expect(shrinkKFor('q10')).toBeGreaterThan(shrinkKFor('q25'));
    expect(shrinkKFor('q25')).toBeGreaterThan(shrinkKFor('q50'));
  });

  it('ignores a bucket with too few of the channel to estimate anything', () => {
    // Held-out calibration (scripts/check-band-calibration.ts) showed per-channel quantiles
    // never beat the corpus at ANY shrinkage with today's data — median 0-11 videos per
    // bucket. So a bucket only counts once there is enough of the channel in it.
    const s = shrinkToGlobal({ ...tight, n: [MIN_CHANNEL_BUCKET_N - 1, MIN_CHANNEL_BUCKET_N] }, G);
    for (const k of QUANTILE_KEYS) expect(s[k][0]).toBeCloseTo(G[k][0], 12);    // gated out
    // the second bucket just qualifies, so it moves off global (q50 is 0 in both fixtures)
    for (const k of ['q10', 'q25', 'q75', 'q90'] as const) expect(s[k][1]).not.toBeCloseTo(G[k][1], 6);
  });

  it('barely moves a tail quantile on a channel with five day-30 videos', () => {
    const s = shrinkToGlobal({ ...tight, n: [5, 5] }, G, SHRINK_K, 0);
    const moved = (k: 'q90' | 'q50') => Math.abs(s[k][0] - G[k][0]) / Math.abs(tight[k][0] - G[k][0] || 1);
    expect(moved('q90')).toBeLessThan(0.2);
  });

  it('keeps the band containing its own forecast and the quantiles ordered', () => {
    for (const n of [0, 3, 8, 50, 5000]) {
      const s = shrinkToGlobal({ ...tight, n: [n, n] }, G, SHRINK_K, 0);
      for (let i = 0; i < s.ages.length; i++) {
        expect(s.q10[i]).toBeLessThanOrEqual(s.q25[i]);
        expect(s.q25[i]).toBeLessThanOrEqual(s.q50[i]);
        expect(s.q50[i]).toBeLessThanOrEqual(s.q75[i]);
        expect(s.q75[i]).toBeLessThanOrEqual(s.q90[i]);
        expect(s.q10[i]).toBeLessThanOrEqual(0);
        expect(s.q90[i]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('a channel table with different ages than global is refused rather than mis-aligned', () => {
    expect(() => shrinkToGlobal({ ...tight, ages: [1, 7], n: [10, 10] }, G)).toThrow(/ages/);
  });
});

// ---------------------------------------------------------------- step 2 ----
// Using the video's own trajectory: a video that has been sitting exactly on its channel's
// curve for ten days is far more predictable than one we glimpsed once.
describe('trajectoryFactor', () => {
  // `expected` is the channel curve at that day; a video exactly on it has a flat log residual.
  const onCurve = (days: number[], scale = 2) =>
    days.map((day) => ({ day, expected: 1000 * Math.log(day + 1), views: scale * 1000 * Math.log(day + 1) }));

  it('is the floor for 20 samples that lie exactly on the channel curve over a long span', () => {
    const days = Array.from({ length: 20 }, (_, i) => 0.5 + (i * 10) / 19);
    expect(trajectoryFactor(onCurve(days))).toBeCloseTo(BAND_FACTOR_FLOOR, 9);
    // The review asked for a 0.5 floor. Held-out calibration says 0.5 drops the "4 in 5" band
    // to 72.3% coverage; 0.85 holds it at 79.6%. The real number is pinned, not the wish.
    expect(BAND_FACTOR_FLOOR).toBe(0.85);
  });

  it('is exactly 1 for a single measurement, or none', () => {
    expect(trajectoryFactor(onCurve([3]))).toBe(1);
    expect(trajectoryFactor([])).toBe(1);
  });

  it('is monotone non-increasing as the measured span grows', () => {
    let prev = Infinity;
    for (const span of [0.2, 0.5, 1, 2, 4, 7, 14, 30]) {
      const days = Array.from({ length: 12 }, (_, i) => 0.5 + (i * span) / 11);
      const f = trajectoryFactor(onCurve(days));
      expect(f).toBeLessThanOrEqual(prev + 1e-12);
      prev = f;
    }
  });

  it('is monotone non-increasing as the fit gets better', () => {
    const days = Array.from({ length: 12 }, (_, i) => 0.5 + (i * 10) / 11);
    let prev = -Infinity;
    // walk from a good fit to a bad one: the factor must not fall
    for (const noise of [0, 0.02, 0.05, 0.1, 0.2, 0.4, 0.8]) {
      const pts = onCurve(days).map((p, i) => ({ ...p, views: p.views * Math.exp(noise * (i % 2 ? 1 : -1)) }));
      const f = trajectoryFactor(pts);
      expect(f).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = f;
    }
  });

  it('never leaves [floor, 1]', () => {
    const days = Array.from({ length: 30 }, (_, i) => 0.1 + i);
    for (const noise of [0, 0.5, 3, 10]) {
      const pts = onCurve(days).map((p, i) => ({ ...p, views: Math.max(1, p.views * Math.exp(noise * Math.sin(i))) }));
      const f = trajectoryFactor(pts);
      expect(f).toBeGreaterThanOrEqual(BAND_FACTOR_FLOOR - 1e-12);
      expect(f).toBeLessThanOrEqual(1 + 1e-12);
    }
  });

  it('weights by log-age spacing, so a burst of launch samples cannot outvote the daily record', () => {
    // Malecki's shape: one sample on day 3.48, then 20 within a third of a day around day 5.2.
    const burst = [{ day: 3.48, expected: 1000, views: 2000 }];
    for (let i = 0; i < 20; i++) burst.push({ day: 5.0 + i * 0.017, expected: 1000, views: 2600 });
    const fit = fitTrajectory(burst);
    // an unweighted mean would sit at ~0.94 (20 of 21 points at log 2.6); the trapezoid
    // weighting in log(day+1) puts it near the midpoint of the two distinct positions
    expect(fit.logScale).toBeGreaterThan(Math.log(2.0));
    expect(fit.logScale).toBeLessThan(Math.log(2.6));
    expect(fit.spanDays).toBeCloseTo(5.323 - 3.48, 2);
  });

  it('reports zero dispersion for a perfect fit and grows with scatter', () => {
    const days = [1, 2, 4, 8];
    expect(fitTrajectory(onCurve(days)).rms).toBeCloseTo(0, 9);
    const noisy = onCurve(days).map((p, i) => ({ ...p, views: p.views * Math.exp(i % 2 ? 0.3 : -0.3) }));
    expect(fitTrajectory(noisy).rms).toBeGreaterThan(0.2);
  });
});

// ------------------------------------------------- inner / outer bands ------
describe('forecastBand returns an inner and an outer range', () => {
  const T: BandTable = {
    ages: [1, 4], q10: [-0.40, -0.20], q25: [-0.20, -0.10], q50: [0, 0],
    q75: [0.30, 0.15], q90: [0.60, 0.30], n: [1000, 1000],
  };

  it('puts the q25..q75 range inside the q10..q90 one', () => {
    const b = forecastBand(19001, 30, 4, T)!;
    expect(b.inner[0]).toBeGreaterThan(b.outer[0]);
    expect(b.inner[1]).toBeLessThan(b.outer[1]);
    expect(b.inner[0]).toBeCloseTo(19001 * Math.exp(-0.10), 6);
    expect(b.inner[1]).toBeCloseTo(19001 * Math.exp(0.15), 6);
    expect(b.outer[0]).toBeCloseTo(19001 * Math.exp(-0.20), 6);
    expect(b.outer[1]).toBeCloseTo(19001 * Math.exp(0.30), 6);
  });

  it('applies the trajectory factor to the log width of both', () => {
    const full = forecastBand(19001, 30, 4, T, 1)!;
    const half = forecastBand(19001, 30, 4, T, 0.5)!;
    expect(Math.log(half.outer[1] / 19001)).toBeCloseTo(Math.log(full.outer[1] / 19001) / 2, 9);
    expect(Math.log(half.inner[0] / 19001)).toBeCloseTo(Math.log(full.inner[0] / 19001) / 2, 9);
  });

  it('still has zero width at the last measurement, whatever the factor', () => {
    for (const f of [1, 0.75, 0.5]) {
      const b = forecastBand(15465, 3.955, 3.955, T, f)!;
      expect(b.outer[1] - b.outer[0]).toBeCloseTo(0, 6);
      expect(b.inner[1] - b.inner[0]).toBeCloseTo(0, 6);
    }
  });
});

describe('heldOut', () => {
  const ids = Array.from({ length: 4000 }, (_, i) => `vid${i.toString(36)}xyz`);

  it('is deterministic — the same id is always on the same side', () => {
    for (const id of ids.slice(0, 50)) expect(heldOut(id)).toBe(heldOut(id));
  });

  it('holds out roughly the share asked for', () => {
    const share = ids.filter((id) => heldOut(id, 1 / 16)).length / ids.length;
    expect(share).toBeGreaterThan(0.04);
    expect(share).toBeLessThan(0.09);
  });

  it('holds out nothing at 0 and everything at 1', () => {
    expect(ids.some((id) => heldOut(id, 0))).toBe(false);
    expect(ids.every((id) => heldOut(id, 1))).toBe(true);
  });

  it('is stable across shares — widening the holdout only adds', () => {
    const small = new Set(ids.filter((id) => heldOut(id, 1 / 32)));
    for (const id of small) expect(heldOut(id, 1 / 8)).toBe(true);
  });
});
