// Times the reader can check against their own clock.
//
// The backend is UTC and the internal tools (admin pages, scripts) are ET, because that is
// Brandon's clock and he is the only person reading them. The app is not internal: a creator in
// Berlin reading "Sep 4, 10:31 AM ET" has to do arithmetic before they can compare a chart to
// the day they remember having. So every timestamp the app shows is formatted in the VIEWER's
// zone, and the zone is named once — in the tooltip header — so a screenshot is still unambiguous.
//
// Every helper takes an explicit `timeZone` and defaults to the runtime's (Intl's own default).
// That default is the whole point: pass nothing in the browser and it is the viewer's zone; pass
// 'UTC' or 'America/Los_Angeles' in a test and the output is pinned. The one rule that follows
// from it: a string formatted on the SERVER and one formatted on the CLIENT would disagree, so
// the app never renders these on the server — the page passes epoch milliseconds across and the
// client component formats. (components/app/local-time.tsx)

const asDate = (at: string | number | Date | null | undefined): Date | null => {
  if (at == null) return null;
  const d = at instanceof Date ? at : new Date(at);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** The options every helper shares, with the zone left to the runtime unless one is given. */
const opts = (timeZone: string | undefined, o: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions =>
  (timeZone ? { ...o, timeZone } : o);

/** "Sep 4" — a day, in the viewer's zone. */
export function localDay(at: string | number | Date | null | undefined, timeZone?: string): string {
  const d = asDate(at);
  return d ? d.toLocaleDateString('en-US', opts(timeZone, { month: 'short', day: 'numeric' })) : '';
}

/** "Sep 4, 2026" — the same day when the year is not obvious. */
export function localDayYear(at: string | number | Date | null | undefined, timeZone?: string): string {
  const d = asDate(at);
  return d ? d.toLocaleDateString('en-US', opts(timeZone, { month: 'short', day: 'numeric', year: 'numeric' })) : '';
}

/** "10 AM" — the hour alone, for a sub-day axis where the day is already said. */
export function localHour(at: string | number | Date | null | undefined, timeZone?: string): string {
  const d = asDate(at);
  return d ? d.toLocaleTimeString('en-US', opts(timeZone, { hour: 'numeric' })) : '';
}

/** "Sep 4, 10 AM" — the axis label under a launch-window zoom. */
export function localDayHour(at: string | number | Date | null | undefined, timeZone?: string): string {
  const d = asDate(at);
  if (!d) return '';
  return `${localDay(d, timeZone)}, ${localHour(d, timeZone)}`;
}

/** "Sep 4, 10:31 AM" — a moment, without naming the zone. */
export function localDateTime(at: string | number | Date | null | undefined, timeZone?: string): string {
  const d = asDate(at);
  if (!d) return '';
  const time = d.toLocaleTimeString('en-US', opts(timeZone, { hour: 'numeric', minute: '2-digit' }));
  return `${localDay(d, timeZone)}, ${time}`;
}

/**
 * "EDT" / "GMT+2" — the zone, as the runtime names it. Said ONCE per page, in the tooltip
 * header: a chart whose every label carried a zone would be shouting the same fact forty times,
 * and one that never said it would leave a screenshot unreadable.
 */
export function zoneAbbrev(at: string | number | Date | null | undefined, timeZone?: string): string {
  const d = asDate(at);
  if (!d) return '';
  const parts = new Intl.DateTimeFormat('en-US', opts(timeZone, { timeZoneName: 'short' })).formatToParts(d);
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
}

/** "Sep 4, 10:31 AM EDT" — the tooltip's header line. */
export function localDateTimeZone(at: string | number | Date | null | undefined, timeZone?: string): string {
  const d = asDate(at);
  if (!d) return '';
  const z = zoneAbbrev(d, timeZone);
  return z ? `${localDateTime(d, timeZone)} ${z}` : localDateTime(d, timeZone);
}

/** "Aug 30 – Sep 1", collapsed to one day when both ends land on it. */
export function localDayRange(
  from: string | number | Date | null | undefined,
  to: string | number | Date | null | undefined,
  timeZone?: string
): string {
  const a = localDay(from, timeZone), b = localDay(to, timeZone);
  if (!a) return b;
  if (!b || a === b) return a;
  return `${a} – ${b}`;
}
