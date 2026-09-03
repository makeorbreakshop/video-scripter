// How each series kind is drawn, and what it is called.
//
// The point of the kinds is that a reader can tell them apart. Drawing the reconstructed past
// and the forecast future both as accent-green dashed lines with an accent band defeated that:
// two different claims, one appearance. So the past is muted and dotted with NO band — it is a
// reconstruction of something that already happened, and dressing it in an uncertainty ribbon
// invites the eye to read it as a projection — and the future keeps the accent, the dash and
// its (now fitted, lib/scoring/bands.ts) band.
import type { SeriesKind, SeriesPoint } from './chart-series';
import type { Actual, CurvePoint } from '../admin/video-curve';

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

// ------------------------------------------------------------- the ribbons ---

export type BandRing = 'inner' | 'outer';

/**
 * Two ribbons, not one. A single band forces a choice between "honest about the tail" and
 * "useful about the likely case"; drawing both lets the eye read the middle and still see how
 * far the tail goes. The inner is the darker of the two so the middle reads as the claim.
 */
export const BAND_STYLES: Record<BandRing, { fillOpacity: number }> = {
  inner: { fillOpacity: 0.16 },
  outer: { fillOpacity: 0.06 },
};

export function bandStyle(ring: BandRing) {
  return BAND_STYLES[ring];
}

/** Odds a reader can hold in their head, not percentile names. */
export const BAND_LABELS: Record<BandRing, string> = {
  inner: 'half of videos land here',
  outer: '4 in 5 land here',
};

// ------------------------------------------------------------------ rows ----

export interface ChartRow {
  day: number;
  expected?: number;
  band?: [number, number];
  projected?: number;
  bandInner?: [number, number];
  bandOuter?: [number, number];
  implied?: number;
  views?: number;
  dot?: number;
}

/**
 * The series, the channel curve and the real measurements zipped into one row per day — the
 * shape recharts wants. Pure, so what the chart draws can be asserted without mounting it.
 *
 * Each segment also writes its value into its NEIGHBOUR's key at the boundary day, so the
 * dotted past, the solid measured line and the dashed forecast meet instead of leaving a
 * one-pixel hole where the kind changes. Only the forecast carries ribbons: an uncertainty
 * band around a reconstruction of something that already happened would read as a projection.
 */
export function chartRows(series: SeriesPoint[], curve: CurvePoint[], actuals: Actual[]): ChartRow[] {
  const byDay = new Map<number, ChartRow>();
  const at = (d: number) => {
    let r = byDay.get(d);
    if (!r) { r = { day: d }; byDay.set(d, r); }
    return r;
  };
  for (const c of curve) Object.assign(at(c.day), { expected: c.expected, band: [c.lo, c.hi] as [number, number] });
  const kindAt = new Map(series.map((p) => [p.day, p.kind] as const));
  for (let i = 0; i < series.length; i++) {
    const p = series[i];
    const row = at(p.day);
    const prev = series[i - 1], next = series[i + 1];
    const touches = (k: SeriesKind) => prev?.kind === k || next?.kind === k;
    if (p.kind === 'measured' || touches('measured')) row.views = p.views;
    if (p.kind === 'implied' || touches('implied')) row.implied = p.views;
    if (p.kind === 'forecast' || touches('forecast')) {
      row.projected = p.views;
      if (p.kind === 'forecast' && p.band) {
        row.bandInner = p.band.inner;
        row.bandOuter = p.band.outer;
      }
    }
  }
  for (const a of actuals) if (kindAt.get(a.day) === 'measured') at(a.day).dot = a.views;
  return [...byDay.values()].sort((a, b) => a.day - b.day);
}
