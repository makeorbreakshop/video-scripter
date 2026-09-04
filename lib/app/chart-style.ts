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
import { compactNumber } from './feed-format';
import { localDay, localDateTimeZone } from './local-time';

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

/** The recharts series `name`s. Not the legend: the legend draws itself (see LEGEND_LABELS). */
export const SERIES_LABELS = {
  measured: 'this video · measured',
  implied: 'this video · estimated before tracking',
  forecast: 'expected from here',
  expected: 'typical for this channel',
} as const;

/**
 * The legend, as a reader would say it: THREE things on this chart.
 *
 * It used to have four, and two of them began with the same three words — "this video ·
 * measured" and "this video · estimated before tracking" — which asked the reader to hold a
 * distinction the chart was already making with its own ink. The solid stretch, the dotted
 * stretch and the dashed stretch are one subject: this video. One entry, one swatch, and the
 * swatch shows all three segments so the line kinds are still explained — by being shown.
 */
export const LEGEND_LABELS = {
  video: 'this video',
  forecast: 'expected from here',
  expected: 'typical for this channel',
} as const;

export type LegendKey = keyof typeof LEGEND_LABELS;

/** How the entry's swatch is drawn: the video's three segments, the ribbon, the grey dash. */
export type LegendSwatch = 'segments' | 'ribbon' | 'dashed';

/**
 * The order the legend reads in, and it is not the order recharts would give (which is the
 * order the shapes happen to be painted in, so the video — the only thing on the chart we
 * actually counted — came last, after the channel's curve). It reads outward from what is
 * known: this video, what we expect of it next, and only then the other subject on the plot.
 */
export const LEGEND_ORDER: readonly LegendKey[] = ['video', 'forecast', 'expected'];

const SWATCHES: Record<LegendKey, LegendSwatch> = {
  video: 'segments', forecast: 'ribbon', expected: 'dashed',
};

/** The legend entries actually present, in LEGEND_ORDER. `ribbon` marks the one with a band. */
export function legendEntries(
  has: Partial<Record<LegendKey, boolean>>
): Array<{ key: LegendKey; label: string; swatch: LegendSwatch; ribbon: boolean }> {
  return LEGEND_ORDER.filter((k) => has[k]).map((key) => ({
    key, label: LEGEND_LABELS[key], swatch: SWATCHES[key], ribbon: SWATCHES[key] === 'ribbon',
  }));
}

/**
 * The label pinned at the first measurement: "tracking began Sep 1". Without it the dotted
 * stretch on the left reads as missing data rather than as the honest statement that we were
 * not watching yet. Null when there is nothing to explain — no measurement, no publish time,
 * or tracking that started at publish.
 */
export function trackingBeganLabel(
  publishedAt: string | Date | null | undefined,
  firstMeasuredDay: number | null | undefined,
  /** The reader's zone. Absent means the runtime's, which in the browser is the viewer's own. */
  timeZone?: string
): string | null {
  if (publishedAt == null || firstMeasuredDay == null || !Number.isFinite(firstMeasuredDay)) return null;
  // Under ~2 hours after publish there is no reconstructed past worth naming.
  if (firstMeasuredDay < 2 / 24) return null;
  const t0 = new Date(publishedAt).getTime();
  if (!Number.isFinite(t0)) return null;
  const at = new Date(t0 + firstMeasuredDay * 86_400_000);
  return `tracking began ${localDay(at, timeZone)}`;
}

/**
 * Where the "tracking began" marker goes, and it goes at the TOP.
 *
 * At the bottom it sat exactly where the channel's typical curve runs in the first hours of a
 * video's life — flat, near the floor — so on Matt Wolfe's GPT-6 video the words and the grey
 * line were the same pixels. Top of the plot area, with a halo behind the text (the plot's own
 * background token, drawn by the caller), so no line ever crosses it wherever it lands.
 *
 * It used to be drawn only in the full view, so the
 * 72h zoom — the one showing the launch the label exists to explain — had a dotted stretch and
 * no word for it. In the zoom the first measurement can also sit outside the visible range, so
 * the line is clamped to the plot and the text is flipped inward when it is near the right
 * edge, rather than being written off the side of the chart. Null when there is nothing to place.
 */
export type LabelPosition = 'insideTopLeft' | 'insideTopRight';
export function trackingLabelPlacement(
  firstMeasuredDay: number | null | undefined,
  maxDay: number
): { x: number; position: LabelPosition } | null {
  if (firstMeasuredDay == null || !Number.isFinite(firstMeasuredDay) || !(maxDay > 0)) return null;
  const x = Math.min(Math.max(firstMeasuredDay, 0), maxDay);
  // The text runs to the right of the line, so past three-quarters of the width it would run
  // off the plot; there it is written back to the left instead.
  return { x, position: x > maxDay * 0.75 ? 'insideTopRight' : 'insideTopLeft' };
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

/**
 * The y range the reader is actually looking at.
 *
 * recharts' `domain={[0, 'auto']}` fits the whole DATA SET, not the visible slice, which was the
 * second half of the kUcMWnhDF4U bug (2026-09-04): an hour-old video with 1,446 views drawn on
 * an axis whose top was the channel's typical curve at day 3 — 148,000 — so the only line worth
 * reading was a flat smear on the floor. The axis is computed here instead, from the rows inside
 * the current domain and only the series a reader is being shown: what we measured, the
 * reconstruction, the forecast median and its drawn (inner) band, and the channel's typical line.
 * The undrawn outer band never sets the scale — it is a tooltip fact, not a picture.
 *
 * Null when there is nothing in view, which is the caller's cue to let recharts decide.
 */
export function visibleYDomain(
  rows: ChartRow[],
  domain: [number, number],
  scale: ScaleMode = 'linear'
): [number, number] | null {
  const vals: number[] = [];
  for (const r of rows) {
    if (!(r.day >= domain[0] && r.day <= domain[1])) continue;
    for (const v of [r.views, r.implied, r.projected, r.expected, r.dot, r.bandInner?.[0], r.bandInner?.[1]]) {
      if (v != null && Number.isFinite(v)) vals.push(v as number);
    }
  }
  const usable = scale === 'log' ? vals.filter((v) => v > 0) : vals;
  if (!usable.length) return null;
  const hi = Math.max(...usable), lo = Math.min(...usable);
  // A little air above the top line so its end label is not clipped by the frame.
  if (scale === 'log') return [Math.max(1, lo / 1.6), Math.max(hi * 1.25, 2)];
  // Linear starts at zero: a view count axis that does not is a chart that exaggerates.
  return [0, Math.max(hi * 1.08, 1)];
}

// ------------------------------------------------ chart v2: fewer things at rest ----

/**
 * Which rings are actually PAINTED. Two ribbons put two uncertainties on one plate and left
 * the reader working out whose was whose; only the middle half is drawn now. The 10–90 range
 * is not withdrawn — it is still fitted, still carried on every forecast point, and still said
 * out loud in the tooltip's last line. Drawn and known are different things.
 */
export const BAND_DISPLAY: Record<BandRing, boolean> = { inner: true, outer: false };

/** The rings the plot mounts, in paint order. */
export const DRAWN_RINGS: BandRing[] = (['outer', 'inner'] as BandRing[]).filter((r) => BAND_DISPLAY[r]);

/**
 * The props the ribbon's <Area> is given.
 *
 * `activeDot: false` is the point of this function. recharts puts an active dot on every Area
 * by default, so hovering anywhere near the forecast lit two dots on the ribbon's EDGES —
 * quantiles of a fitted band, drawn exactly like the measurements below them. Nothing on this
 * chart may look like a measurement unless we measured it. Returned as an object so a node
 * test can assert it without mounting recharts.
 */
export function areaProps(ring: BandRing, accent: string, theme: ThemeMode = 'light') {
  return {
    stroke: 'none' as const,
    fill: accent,
    fillOpacity: bandStyle(ring, theme).fillOpacity,
    dot: false as const,
    activeDot: false as const,
    connectNulls: true as const,
    isAnimationActive: false as const,
    legendType: 'none' as const,
  };
}

/** The y-axis scales the legend's toggle offers. Linear first: it is the default. */
export const SCALE_MODES = ['linear', 'log'] as const;
export type ScaleMode = (typeof SCALE_MODES)[number];

export function nextScale(mode: ScaleMode): ScaleMode {
  return mode === 'linear' ? 'log' : 'linear';
}

/** Which part of the line the cursor is on. Only the forecast has a range to talk about. */
export type TooltipKind = 'measured' | 'implied' | 'forecast';

export interface TooltipPoint {
  /** The moment under the cursor, as an ISO string or Date. */
  at: string | Date;
  /** Absent behaves as a measured point: a count, and no talk of ranges. */
  kind?: TooltipKind;
  views?: number | null;
  typical?: number | null;
  inner?: readonly [number, number] | null;
  outer?: readonly [number, number] | null;
  /** The reader's zone; absent means the runtime's. Only the header line uses it. */
  timeZone?: string;
}

/**
 * What the tooltip says. Three lines on a point we counted; two more only where there is
 * genuinely a range.
 *
 * Two faults it is fixing. A measured point was carrying "likely" and "range" lines because the
 * ROW carried a band — the boundary day writes into its neighbour's keys so the segments meet —
 * so hovering a real measurement produced a forecast's paragraph about a number we already knew.
 * And the ranges were written from the raw quantiles through compactNumber, so a tight band near
 * the present rendered as "264K–264K": a range with no width, which reads as a bug rather than
 * as certainty. A range whose two ends print the same is not a range and is not said.
 *
 * "likely" is the middle of the fitted band and "range" is the wider one — the odds live in
 * those two words now, not in a footnote under the legend nor in a sentence in every tooltip.
 *
 * The header line is in the READER's zone and names it once: "Sep 4, 10:31 AM EDT".
 */
export function tooltipLines(p: TooltipPoint): string[] {
  const lines: string[] = [];
  const d = p.at instanceof Date ? p.at : new Date(p.at);
  if (!Number.isNaN(d.getTime())) {
    // The ONE place the chart names a zone. Every other label on the page is bare, because
    // forty labels each ending in "EDT" is a chart shouting one fact; a tooltip that never says
    // it is a screenshot nobody can read. (lib/app/local-time.ts)
    lines.push(localDateTimeZone(d, p.timeZone));
  }
  const num = (n: number) => compactNumber(n);
  if (p.views != null && Number.isFinite(p.views)) {
    lines.push(
      p.typical != null && Number.isFinite(p.typical)
        ? `${num(p.views)} views · typical ${num(p.typical)}`
        : `${num(p.views)} views`
    );
  }
  if (p.kind !== 'forecast') return lines.slice(0, 3);
  /** A band whose two ends print the same number is a point, and a point is not a range. */
  const range = (word: string, b: readonly [number, number] | null | undefined) => {
    if (!b) return;
    const lo = num(b[0]), hi = num(b[1]);
    if (lo === hi) return;
    lines.push(`${word} ${lo}–${hi}`);
  };
  range('likely', p.inner);
  range('range', p.outer);
  return lines.slice(0, 4);
}
