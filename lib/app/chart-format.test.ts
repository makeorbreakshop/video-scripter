import {
  etDate, fmtViews, dayLabel, axisDate, tooltipDate, AXIS_DATE, FULL_DATE, MONTH_YEAR, ET,
} from './chart-format';

describe('etDate', () => {
  // 2026-03-05T02:30:00Z is still March 4 in New York — the whole reason this is one helper.
  const late = '2026-03-05T02:30:00Z';
  it('says the date in Eastern, never UTC', () => {
    expect(etDate(late, AXIS_DATE)).toBe('Mar 4');
    expect(etDate(late, FULL_DATE)).toBe('Mar 4, 2026');
    expect(etDate(late, MONTH_YEAR)).toBe('Mar 26');
  });
  it('takes a timestamp, a Date or an ISO string alike', () => {
    const t = Date.parse(late);
    expect(etDate(t, AXIS_DATE)).toBe(etDate(new Date(t), AXIS_DATE));
    expect(etDate(new Date(t), AXIS_DATE)).toBe(etDate(late, AXIS_DATE));
  });
  it('is an em dash rather than "Invalid Date" when there is nothing to say', () => {
    expect(etDate(null, AXIS_DATE)).toBe('—');
    expect(etDate(undefined, AXIS_DATE)).toBe('—');
    expect(etDate('not a date', AXIS_DATE)).toBe('—');
  });
  it('is Eastern and nothing else', () => {
    expect(ET).toBe('America/New_York');
  });
});

describe('fmtViews', () => {
  it('drops precision as the number grows, so an axis label stays short', () => {
    expect(fmtViews(0)).toBe('0');
    expect(fmtViews(940)).toBe('940');
    expect(fmtViews(1200)).toBe('1.2K');
    expect(fmtViews(48_000)).toBe('48K');
    expect(fmtViews(2_400_000)).toBe('2.4M');
  });
});

describe('dayLabel', () => {
  it('counts in hours before day one and in days after', () => {
    expect(dayLabel(0.25)).toBe('6h');
    expect(dayLabel(1)).toBe('day 1');
    expect(dayLabel(2.5)).toBe('day 2.5');
    expect(dayLabel(30.4)).toBe('day 30');
  });
});

describe('axisDate', () => {
  const pub = '2026-03-04T18:00:00Z';
  it('turns a day offset into the calendar date it actually was', () => {
    expect(axisDate(pub, 0, false)).toBe('Mar 4');
    expect(axisDate(pub, 30, false)).toBe('Apr 3');
  });
  it('adds the hour when the reader has zoomed into the launch', () => {
    expect(axisDate(pub, 0, true)).toMatch(/Mar 4 1 PM/);
  });
  it('falls back to the day label when there is no publish time', () => {
    expect(axisDate(null, 3, false)).toBe('day 3');
    expect(tooltipDate(null, 3)).toBe('day 3');
  });
  it('says the zone out loud in a tooltip', () => {
    expect(tooltipDate(pub, 0)).toMatch(/ET$/);
  });
});
