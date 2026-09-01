import {
  median,
  day30Estimate,
  rawBaselineAt,
  baselineRatio,
  temporalScore,
  looksLikeRawBaseline,
  SCORE_CAP,
  PriorVideo,
} from './core';

const env = new Map<number, number>([
  [1, 3000],
  [10, 15000],
  [30, 30000],
  [100, 45000],
  [365, 60000],
]);

describe('median', () => {
  it('handles odd, even, and empty inputs', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(1);
  });
  it('is robust to a single viral outlier', () => {
    expect(median([10000, 11000, 9000, 5000000])).toBe(10500);
  });
});

describe('day30Estimate', () => {
  it('scales the closest snapshot along the envelope shape', () => {
    // snapshot at day 10 with 5000 views; shape says day30 = 2x day10
    const est = day30Estimate(99999, 200, [{ view_count: 5000, days_since_published: 10 }], env);
    expect(est).toBe(5000 * (30000 / 15000));
  });
  it('projects forward for young videos without snapshots', () => {
    const est = day30Estimate(3000, 1, [], env);
    expect(est).toBe(3000 * (30000 / 3000)); // 10x forward projection
  });
  it('backfills for old videos without snapshots', () => {
    const est = day30Estimate(60000, 365, [], env);
    expect(est).toBe(60000 * (30000 / 60000)); // halve back to day 30
  });
  it('clamps envelope lookups beyond 365 days', () => {
    const est = day30Estimate(60000, 4000, [], env);
    expect(est).toBe(60000 * (30000 / 60000));
  });
});

describe('rawBaselineAt', () => {
  const mk = (daysAgoPublished: number, est: number): PriorVideo => ({
    published_at: new Date(Date.UTC(2026, 0, 1) + daysAgoPublished * 86400000),
    day30_estimate: est,
  });
  it('first video baselines against itself', () => {
    expect(rawBaselineAt([mk(0, 8000)], 0)).toBe(8000);
  });
  it('videos 2-10 use all priors', () => {
    const vids = [mk(0, 1000), mk(40, 3000), mk(80, 5000)];
    expect(rawBaselineAt(vids, 2)).toBe(2000); // median(1000,3000)
  });
  it('videos 11+ use last 10 mature priors', () => {
    const vids: PriorVideo[] = [];
    for (let i = 0; i < 12; i++) vids.push(mk(i * 40, 1000 * (i + 1)));
    // video at index 11 published day 440; all 11 priors mature; last 10 = est 2000..11000
    expect(rawBaselineAt(vids, 11)).toBe(median([2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000]));
  });
  it('falls back to last 10 priors when not enough mature', () => {
    const vids: PriorVideo[] = [];
    for (let i = 0; i < 12; i++) vids.push(mk(i, 1000 * (i + 1))); // all published within days of each other
    const b = rawBaselineAt(vids, 11);
    expect(b).toBe(median([2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000]));
  });
  it('never returns below 1', () => {
    expect(rawBaselineAt([mk(0, 0)], 0)).toBe(1);
  });
});

describe('ratio convention round-trip', () => {
  it('ratio*globalP50 reproduces the raw baseline, and score equals day30/raw', () => {
    const raw = 12000;
    const ratio = baselineRatio(raw, env);
    expect(ratio).toBeCloseTo(0.4);
    const score = temporalScore(36000, ratio, env);
    expect(score).toBeCloseTo(36000 / raw); // 3.0 — identical numerics to old convention
  });
  it('caps the score', () => {
    expect(temporalScore(1e12, 0.001, env)).toBe(SCORE_CAP);
  });
});

describe('looksLikeRawBaseline', () => {
  it('flags raw view counts and passes ratios', () => {
    expect(looksLikeRawBaseline(48211)).toBe(true); // typical raw baseline
    expect(looksLikeRawBaseline(0.85)).toBe(false);
    expect(looksLikeRawBaseline(3.2)).toBe(false);
  });
});
