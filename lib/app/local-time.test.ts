// The app's clock is the READER's clock. These tests pin two zones explicitly, because the
// whole contract is "an explicit timeZone wins, and the default is whatever the runtime is".
import {
  localDay, localDayYear, localDayHour, localDateTime, localDateTimeZone, localDayRange, zoneAbbrev,
} from './local-time';

// 2026-09-04T14:31:00Z — 10:31 AM in New York, 7:31 AM in Los Angeles, the 4th in both.
const T = '2026-09-04T14:31:00.000Z';
// 2026-09-04T02:31:00Z — still the 3rd on the US west coast.
const NIGHT = '2026-09-04T02:31:00.000Z';

describe('local-time: an explicit zone is honoured', () => {
  it('formats a day in the zone it is given', () => {
    expect(localDay(T, 'UTC')).toBe('Sep 4');
    expect(localDay(T, 'America/Los_Angeles')).toBe('Sep 4');
    expect(localDay(NIGHT, 'UTC')).toBe('Sep 4');
    expect(localDay(NIGHT, 'America/Los_Angeles')).toBe('Sep 3');
  });

  it('formats a moment in the zone it is given', () => {
    expect(localDateTime(T, 'UTC')).toBe('Sep 4, 2:31 PM');
    expect(localDateTime(T, 'America/Los_Angeles')).toBe('Sep 4, 7:31 AM');
    expect(localDateTime(T, 'America/New_York')).toBe('Sep 4, 10:31 AM');
  });

  it('names the zone once, for the tooltip header', () => {
    expect(zoneAbbrev(T, 'America/New_York')).toBe('EDT');
    expect(zoneAbbrev(T, 'America/Los_Angeles')).toBe('PDT');
    expect(zoneAbbrev(T, 'UTC')).toBe('UTC');
    expect(localDateTimeZone(T, 'America/New_York')).toBe('Sep 4, 10:31 AM EDT');
    expect(localDateTimeZone(T, 'America/Los_Angeles')).toBe('Sep 4, 7:31 AM PDT');
    expect(localDateTimeZone(T, 'UTC')).toBe('Sep 4, 2:31 PM UTC');
  });

  it('writes an hour axis label as a day and an hour', () => {
    expect(localDayHour(T, 'UTC')).toBe('Sep 4, 2 PM');
    expect(localDayHour(T, 'America/Los_Angeles')).toBe('Sep 4, 7 AM');
  });

  it('writes a year when one is asked for', () => {
    expect(localDayYear(T, 'UTC')).toBe('Sep 4, 2026');
  });

  it('collapses a range that starts and ends on one day', () => {
    expect(localDayRange(T, T, 'UTC')).toBe('Sep 4');
    expect(localDayRange(NIGHT, T, 'America/Los_Angeles')).toBe('Sep 3 – Sep 4');
    expect(localDayRange(null, T, 'UTC')).toBe('Sep 4');
  });
});

describe('local-time: the default is the runtime zone, not a pinned one', () => {
  // The jest process runs in one zone; whatever it is, the no-argument call must agree with an
  // explicit call for THAT zone — which is what makes the browser show the viewer's own clock.
  const runtime = Intl.DateTimeFormat().resolvedOptions().timeZone;

  it('agrees with an explicit call for the runtime zone', () => {
    expect(localDateTime(T)).toBe(localDateTime(T, runtime));
    expect(localDay(T)).toBe(localDay(T, runtime));
    expect(localDateTimeZone(T)).toBe(localDateTimeZone(T, runtime));
  });

  it('never hardcodes Eastern', () => {
    // The point of the change: nothing in this module knows about New York.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src = require('fs').readFileSync(require('path').join(__dirname, 'local-time.ts'), 'utf8');
    expect(src.replace(/\/\/[^\n]*/g, '')).not.toMatch(/America\/New_York/);
  });
});

describe('local-time: nonsense in, empty string out', () => {
  it.each([null, undefined, '', 'not a date', NaN])('%p', (v) => {
    expect(localDay(v as any, 'UTC')).toBe('');
    expect(localDateTime(v as any, 'UTC')).toBe('');
    expect(localDateTimeZone(v as any, 'UTC')).toBe('');
    expect(zoneAbbrev(v as any, 'UTC')).toBe('');
  });
});
