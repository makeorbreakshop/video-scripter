import { planWindows, estimateQueries, toIsoDate, Pacer, DAILY_QUERY_BUDGET, QUERIES_PER_MINUTE } from './analytics-queue';

describe('planWindows', () => {
  it('walks from the first upload to today in fixed windows, oldest first', () => {
    const w = planWindows('2026-01-01', '2026-03-02', 30);
    expect(w[0]).toEqual({ from: '2026-01-01', to: '2026-01-30' });
    expect(w[1].from).toBe('2026-01-31');
    expect(w[w.length - 1].to).toBe('2026-03-02');
  });
  it('handles a channel younger than one window', () => {
    expect(planWindows('2026-03-01', '2026-03-05', 30)).toEqual([{ from: '2026-03-01', to: '2026-03-05' }]);
  });
  it('accepts the Date objects pg returns for date columns', () => {
    // interpolating a Date used to yield an invalid date and silently plan zero windows,
    // which the worker read as "already finished"
    const w = planWindows(new Date('2017-05-15T00:00:00Z'), new Date('2026-09-01T00:00:00Z'), 90);
    expect(w.length).toBe(38);
    expect(w[0].from).toBe('2017-05-15');
    expect(toIsoDate(new Date('2026-09-01T00:00:00Z'))).toBe('2026-09-01');
  });
  it('throws rather than planning nothing when a date is unparseable', () => {
    expect(() => planWindows('not-a-date', '2026-01-01', 30)).toThrow(/unparseable/);
  });
  it('is empty when there is nothing to cover', () => {
    expect(planWindows('2026-03-06', '2026-03-05', 30)).toEqual([]);
  });
});

describe('estimateQueries', () => {
  it('accounts for both the video count and the window length', () => {
    // 245 videos, 30-day windows: 195 videos fit per call, so 2 calls per window
    expect(estimateQueries(245, 30)).toBe(2);
    expect(estimateQueries(100, 30)).toBe(1);
    // a longer window means fewer videos per call
    expect(estimateQueries(245, 365)).toBeGreaterThan(estimateQueries(245, 30));
  });
});

describe('Pacer', () => {
  it('allows a burst up to the per-minute ceiling then makes the caller wait', () => {
    let now = 0;
    const p = new Pacer(() => now);
    for (let i = 0; i < QUERIES_PER_MINUTE; i++) expect(p.waitMs(1)).toBe(0);
    expect(p.waitMs(1)).toBeGreaterThan(0);
  });
  it('lets the window roll forward', () => {
    let now = 0;
    const p = new Pacer(() => now);
    for (let i = 0; i < QUERIES_PER_MINUTE; i++) p.waitMs(1);
    now = 61_000;
    expect(p.waitMs(1)).toBe(0);
  });
  it('stops entirely once the daily budget is gone', () => {
    let now = 0;
    const p = new Pacer(() => now, DAILY_QUERY_BUDGET - 1);
    expect(p.exhausted()).toBe(false);
    p.waitMs(1); p.waitMs(1);
    expect(p.exhausted()).toBe(true);
  });
  it('reserves headroom so the nightly sync is never starved', () => {
    expect(DAILY_QUERY_BUDGET).toBeLessThan(100_000);
    expect(QUERIES_PER_MINUTE).toBeLessThan(720);
  });
});
