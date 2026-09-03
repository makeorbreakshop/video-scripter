// How each series kind is drawn, and what it is called.
//
// The point of the kinds is that a reader can tell them apart. Drawing the reconstructed past
// and the forecast future both as accent-green dashed lines with an accent band defeated that:
// two different claims, one appearance. So the past is muted and dotted with NO band — it is a
// reconstruction of something that already happened, and dressing it in an uncertainty ribbon
// invites the eye to read it as a projection — and the future keeps the accent, the dash and
// its (now fitted, lib/scoring/bands.ts) band.
import type { SeriesKind } from './chart-series';

export type StrokeToken = 'accent' | 'muted';
export interface SeriesStyle {
  strokeToken: StrokeToken;
  /** SVG stroke-dasharray; undefined is a solid line. */
  dash?: string;
  width: number;
  opacity: number;
  /** Whether an uncertainty ribbon is drawn behind it. */
  band: boolean;
}

const STYLES: Record<SeriesKind, SeriesStyle> = {
  measured: { strokeToken: 'accent', width: 1.75, opacity: 1, band: false },
  implied: { strokeToken: 'muted', dash: '2 3', width: 1.25, opacity: 0.75, band: false },
  forecast: { strokeToken: 'accent', dash: '5 4', width: 1.25, opacity: 0.6, band: true },
};

export function seriesStyle(kind: SeriesKind): SeriesStyle {
  return STYLES[kind];
}

/** Legend text. What the line is, in the words a reader would use. */
export const SERIES_LABELS = {
  measured: 'this video',
  implied: 'before we started tracking (estimated)',
  forecast: 'expected from here',
  expected: 'typical for this channel',
} as const;

const ET = 'America/New_York';

/**
 * The label pinned at the first measurement: "tracking began Sep 1". Without it the dotted
 * stretch on the left reads as missing data rather than as the honest statement that we were
 * not watching yet. Null when there is nothing to explain — no measurement, no publish time,
 * or tracking that started at publish.
 */
export function trackingBeganLabel(
  publishedAt: string | Date | null | undefined,
  firstMeasuredDay: number | null | undefined
): string | null {
  if (publishedAt == null || firstMeasuredDay == null || !Number.isFinite(firstMeasuredDay)) return null;
  // Under ~2 hours after publish there is no reconstructed past worth naming.
  if (firstMeasuredDay < 2 / 24) return null;
  const t0 = new Date(publishedAt).getTime();
  if (!Number.isFinite(t0)) return null;
  const at = new Date(t0 + firstMeasuredDay * 86_400_000);
  return `tracking began ${at.toLocaleDateString('en-US', { timeZone: ET, month: 'short', day: 'numeric' })}`;
}
