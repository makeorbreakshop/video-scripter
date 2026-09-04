// The right edge of the chart is a fact about the video, not a button the reader has to press.
import { horizonFor, HORIZON_TICKS } from './chart-horizon';

describe('horizonFor(ageDays): how far ahead the forecast is worth drawing', () => {
  // The table Brandon asked for, verbatim: three times the age, clamped, rounded to a tick a
  // reader already has a word for.
  it.each([
    ['an 18-hour video shows 3 days', 18 / 24, 3],
    ['a one-day video still shows 3 days', 1, 3],
    ['a five-day video shows 14 days, not 15', 5, 14],
    ['a twelve-day video shows 30', 12, 30],
    ['a 33-day video shows 90', 33, 90],
    ['a 60-day video shows 180', 60, 180],
    ['a 290-day video is capped at a year', 290, 365],
  ])('%s', (_name, age, expected) => {
    expect(horizonFor(age as number)).toBe(expected);
  });

  it('never draws less than three days, however new the video is', () => {
    expect(horizonFor(0)).toBe(3);
    expect(horizonFor(0.01)).toBe(3);
  });

  it('never draws past a year, however old', () => {
    expect(horizonFor(1000)).toBe(365);
    expect(horizonFor(10_000)).toBe(365);
  });

  it('only ever returns a tick a reader has a word for', () => {
    for (let a = 0; a < 400; a += 0.37) expect(HORIZON_TICKS).toContain(horizonFor(a));
  });

  it('never shrinks as a video gets older', () => {
    let last = 0;
    for (let a = 0; a < 400; a += 0.13) {
      const h = horizonFor(a);
      expect(h).toBeGreaterThanOrEqual(last);
      last = h;
    }
  });

  it('treats nonsense as a brand new video rather than throwing', () => {
    expect(horizonFor(NaN)).toBe(3);
    expect(horizonFor(-5)).toBe(3);
    expect(horizonFor(Infinity)).toBe(365);
  });
});
