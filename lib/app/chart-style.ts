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
  // Correction of 2026-09-04: the reconstruction was drawn in the MUTED token — the channel
  // curve's own colour — so the reader had two grey lines and had to work out which was the
  // video. It is this video, before we were watching: same accent, dotted, and set back in
  // opacity so it never competes with the counts we actually took.
  implied: { strokeToken: 'accent', dash: '2 3', width: 1.25, opacity: 0.55, band: false },
  forecast: { strokeToken: 'accent', dash: '5 4', width: 1.25, opacity: 0.6, band: true },
};

export function seriesStyle(kind: SeriesKind): SeriesStyle {
  return STYLES[kind];
}

/**
 * The channel's typical curve. Not a SeriesKind — it is a different subject, not a different
 * part of this video — so it is a plain grey dashed LINE and nothing else.
 *
 * Correction of 2026-09-04: it used to carry a grey ribbon of its own, which put two bands on
 * one chart and made the reader ask which uncertainty was whose. The channel curve is a
 * BASELINE — where a typical video sat — and the only thing this page is actually uncertain
 * about is what happens next, so the ribbons belong to the forecast alone. Declared here so a
 * test can assert the video's lines never look like it, and that it has no band fields.
 */
export const TYPICAL_STYLE = { strokeToken: 'muted' as StrokeToken, dash: '4 3', width: 1.5, band: false as const };

/** The colour a kind is actually stroked with, given the theme's two tokens. */
export function seriesStroke(kind: SeriesKind, colors: Record<StrokeToken, string>): string {
  return colors[STYLES[kind].strokeToken];
}

/** Legend text. What the line is, in the words a reader would use. */
export const SERIES_LABELS = {
  measured: 'this video · measured',
  implied: 'this video · estimated before tracking',
  forecast: 'expected from here',
  expected: 'typical for this channel',
} as const;

export type LegendKey = keyof typeof SERIES_LABELS;

/**
 * The order the legend reads in, and it is not the order recharts would give (which is the
 * order the shapes happen to be painted in, so the measured line — the only thing on the chart
 * we actually counted — came last, after the channel's curve). It reads outward from what is
 * known: what we measured, what we reconstructed behind it, what we expect ahead of it, and
 * only then the other subject on the plot, the channel.
 */
export const LEGEND_ORDER: readonly LegendKey[] = ['measured', 'implied', 'forecast', 'expected'];

/** The legend entries actually present, in LEGEND_ORDER. `ribbon` marks the one with a band. */
export function legendEntries(has: Partial<Record<LegendKey, boolean>>): Array<{ key: LegendKey; label: string; ribbon: boolean }> {
  return LEGEND_ORDER.filter((k) => has[k]).map((key) => ({ key, label: SERIES_LABELS[key], ribbon: key === 'forecast' }));
}

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

/**
 * Where the "tracking began" marker goes. It used to be drawn only in the full view, so the
 * 72h zoom — the one showing the launch the label exists to explain — had a dotted stretch and
 * no word for it. In the zoom the first measurement can also sit outside the visible range, so
 * the line is clamped to the plot and the text is flipped inward when it is near the right
 * edge, rather than being written off the side of the chart. Null when there is nothing to place.
 */
export type LabelPosition = 'insideBottomLeft' | 'insideBottomRight';
export function trackingLabelPlacement(
  firstMeasuredDay: number | null | undefined,
  maxDay: number
): { x: number; position: LabelPosition } | null {
  if (firstMeasuredDay == null || !Number.isFinite(firstMeasuredDay) || !(maxDay > 0)) return null;
  const x = Math.min(Math.max(firstMeasuredDay, 0), maxDay);
  // The text runs to the right of the line, so past three-quarters of the width it would run
  // off the plot; there it is written back to the left instead.
  return { x, position: x > maxDay * 0.75 ? 'insideBottomRight' : 'insideBottomLeft' };
}

// ------------------------------------------------------------- the ribbons ---

export type BandRing = 'inner' | 'outer';

/** Which ground the ribbon is painted on. The same alpha is not the same ribbon on both. */
export type ThemeMode = 'light' | 'dark';

/**
 * Below this a ribbon is not a ribbon, it is a rumour: on either ground it disappears into the
 * plate at the sizes this chart is drawn at. Asserted per theme, so a future palette change
 * cannot quietly take the forecast's uncertainty off the page again.
 */
export const BAND_OPACITY_FLOOR: Record<BandRing, number> = { inner: 0.16, outer: 0.06 };

/**
 * Two ribbons, not one. A single band forces a choice between "honest about the tail" and
 * "useful about the likely case"; drawing both lets the eye read the middle and still see how
 * far the tail goes. The inner is the darker of the two so the middle reads as the claim.
 *
 * Per theme, because alpha is not perception: the accent green over the dark plate loses more
 * contrast per unit of alpha than the same green over white, so the dark values are the higher
 * pair. Both are above BAND_OPACITY_FLOOR.
 */
export const BAND_STYLES: Record<ThemeMode, Record<BandRing, { fillOpacity: number }>> = {
  light: { inner: { fillOpacity: 0.20 }, outer: { fillOpacity: 0.08 } },
  dark: { inner: { fillOpacity: 0.28 }, outer: { fillOpacity: 0.11 } },
};

export function bandStyle(ring: BandRing, theme: ThemeMode = 'light') {
  return BAND_STYLES[theme][ring];
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
 * band around a reconstruction of something that already happened would read as a projection,
 * and the channel's typical curve is a baseline, not a prediction.
 */
export function chartRows(series: SeriesPoint[], curve: CurvePoint[], actuals: Actual[]): ChartRow[] {
  const byDay = new Map<number, ChartRow>();
  const at = (d: number) => {
    let r = byDay.get(d);
    if (!r) { r = { day: d }; byDay.set(d, r); }
    return r;
  };
  // The channel curve contributes its LINE and nothing else — see TYPICAL_STYLE. Its lo/hi are
  // read (and still fitted) but never drawn: one chart, one uncertainty, and it is the forecast's.
  for (const c of curve) at(c.day).expected = c.expected;
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
