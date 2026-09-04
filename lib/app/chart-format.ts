// How every chart in the app says a number and a date.
//
// This used to live inside components/app/video-chart.tsx, which meant the channel baseline
// chart grew its own `axisTick`/`fullDay` pair — two spellings of "Mar 4" in one product, and
// neither of them asserted anywhere. It is pure and it is shared, so it lives under lib/app
// with the rest of the chart's decisions and video-chart.tsx re-exports it for the components
// that already import from there.
//
// Everything is Eastern. The app never shows UTC.

export const ET = 'America/New_York';

/** Month and day — the x axis of both charts, and the only thing an axis tick has room for. */
export const AXIS_DATE: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
/** Month, day and year — a hover card, where the year is worth its width. */
export const FULL_DATE: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
/** Month and 2-digit year — a decade of uploads, where the day is noise. */
export const MONTH_YEAR: Intl.DateTimeFormatOptions = { month: 'short', year: '2-digit' };

/** One date, in Eastern, in one of the formats above. Invalid input reads as an em dash. */
export function etDate(at: Date | number | string | null | undefined, opts: Intl.DateTimeFormatOptions): string {
  if (at == null) return '—';
  const d = at instanceof Date ? at : new Date(at);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-US', { timeZone: ET, ...opts }) : '—';
}

export function fmtViews(v: number) {
  return v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + 'K' : String(Math.round(v));
}

export function dayLabel(d: number) {
  return d < 1 ? `${Math.round(d * 24)}h` : `day ${d < 10 ? d.toFixed(d % 1 ? 1 : 0) : Math.round(d)}`;
}

function dateAtDay(publishedAt: string | Date | null | undefined, day: number): Date | null {
  if (!publishedAt) return null;
  const t0 = new Date(publishedAt).getTime();
  return Number.isFinite(t0) ? new Date(t0 + day * 86_400_000) : null;
}

/** The video chart's x axis: a day offset, said as the calendar date it actually was. */
export function axisDate(publishedAt: string | Date | null | undefined, day: number, launch: boolean): string {
  const d = dateAtDay(publishedAt, day);
  if (!d) return dayLabel(day);
  return launch
    ? d.toLocaleString('en-US', { timeZone: ET, month: 'short', day: 'numeric', hour: 'numeric' }).replace(',', '')
    : etDate(d, AXIS_DATE);
}

export function tooltipDate(publishedAt: string | Date | null | undefined, day: number): string {
  const d = dateAtDay(publishedAt, day);
  if (!d) return dayLabel(day);
  return d.toLocaleString('en-US', { timeZone: ET, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';
}
