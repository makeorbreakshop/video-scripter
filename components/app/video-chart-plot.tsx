'use client';

// The recharts half of the video chart, split out so next/dynamic can keep ~1 MB of charting
// library off the video page's critical path. Everything that is not recharts — the hover
// context the packaging strip shares, the theme colours, the date formatting — stays in
// video-chart.tsx, which this imports.
//
// v5, 2026-09-04: the viewport has a HANDLE. Dragging across the plot to zoom is gone — it had
// no affordance, nothing to adjust afterwards, and a text selection as its side effect. Under
// the x-axis there is now a brush track: a mini-map of this video's line with a window on it
// you can widen, narrow or slide, and a double-click to come back. The chips are that window
// preset. Nothing else on the plate is words.
//
// Every decision this file makes — the horizon, the ticks, which packaging groups collapse,
// what the tooltip says, where a dragged handle is allowed to stop — lives in a pure module
// under lib/app and is asserted there. What is left here is wiring and pointer capture.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
  ReferenceDot, ReferenceArea,
} from 'recharts';
import { type Actual, type CurvePoint } from '@/lib/admin/video-curve';
import type { SeriesPoint } from '@/lib/app/chart-series';
import type { PackagingMark } from '@/lib/app/packaging-groups';
import {
  seriesStyle, chartRows, bandStyle, SERIES_LABELS, trackingBeganLabel, trackingLabelPlacement,
  TYPICAL_STYLE, legendEntries, areaProps, DRAWN_RINGS, SCALE_MODES, nextScale, tooltipLines,
  visibleYDomain, niceTicks, CHART_TYPE, type ScaleMode, type TooltipKind,
} from '@/lib/app/chart-style';
import { markerLayout, markAt } from '@/lib/app/chart-marks';
import { axisTicks, isFullDomain, rangeChips, chipViewport, activeChip } from '@/lib/app/chart-zoom';
import {
  BRUSH_HEIGHT, HANDLE_HIT, HANDLE_WIDTH, PLOT_INSET, brushPaths, clampWindow, dragEdge,
  nudgeEdge, panWindow, partAt, windowRect, type Edge,
} from '@/lib/app/chart-brush';
import { useMarkerHover, useThemeColors, fmtViews, axisDate, HoverCard } from './video-chart';

/**
 * The legend, drawn by hand rather than by recharts, and three entries long.
 *
 * Three reasons it is not recharts'. Order: recharts lists series in the order they are PAINTED,
 * which put the channel's curve first and the one line we actually measured last. Count: the
 * video was two entries opening with the same three words, so the legend spent half its width
 * on a distinction the chart's own ink already makes — one entry now, whose swatch shows the
 * solid, dotted and dashed segments together. And the ribbon: the forecast is the only series
 * carrying uncertainty, so its swatch is the band itself, at the fill the chart uses.
 *
 * The scale toggle sits at its right end. There is no footnote under it any more; the odds are
 * the words "likely" and "range" in the tooltip and nowhere else.
 */
function LegendSwatchMark({ swatch, accent, muted, mode }: {
  swatch: 'segments' | 'ribbon' | 'dashed'; accent: string; muted: string; mode: 'light' | 'dark';
}) {
  const S = { measured: seriesStyle('measured'), implied: seriesStyle('implied'), forecast: seriesStyle('forecast') };
  return (
    <svg width={26} height={12} aria-hidden style={{ overflow: 'visible', flex: '0 0 auto' }}>
      {swatch === 'ribbon' && (
        <>
          <rect x={0} y={2.5} width={26} height={7} fill={accent} fillOpacity={bandStyle('inner', mode).fillOpacity} />
          <line x1={0} y1={6} x2={26} y2={6} stroke={accent} strokeWidth={S.forecast.width}
                strokeDasharray={S.forecast.dash} strokeOpacity={S.forecast.opacity} />
        </>
      )}
      {swatch === 'dashed' && (
        <line x1={0} y1={6} x2={26} y2={6} stroke={muted} strokeWidth={TYPICAL_STYLE.width} strokeDasharray={TYPICAL_STYLE.dash} />
      )}
      {/* One line, three stretches: what we reconstructed, what we counted, what we expect. */}
      {swatch === 'segments' && (
        <>
          <line x1={0} y1={6} x2={8} y2={6} stroke={accent} strokeWidth={S.implied.width}
                strokeDasharray={S.implied.dash} strokeOpacity={S.implied.opacity} />
          <line x1={8} y1={6} x2={18} y2={6} stroke={accent} strokeWidth={S.measured.width} />
          <line x1={18} y1={6} x2={26} y2={6} stroke={accent} strokeWidth={S.forecast.width}
                strokeDasharray={S.forecast.dash} strokeOpacity={S.forecast.opacity} />
        </>
      )}
    </svg>
  );
}

function ChartLegend({ entries, accent, muted, mode, scale, onScale }: {
  entries: ReturnType<typeof legendEntries>;
  accent: string; muted: string; mode: 'light' | 'dark';
  scale: ScaleMode; onScale: () => void;
}) {
  return (
    <ul style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: '4px 16px', margin: 0, padding: 0, listStyle: 'none' }}>
      {entries.map((e) => (
        <li key={e.key} style={{ display: 'flex', alignItems: 'center', gap: 6, color: muted, fontSize: 11 }}>
          <LegendSwatchMark swatch={e.swatch} accent={accent} muted={muted} mode={mode} />
          <span>{e.label}</span>
        </li>
      ))}
      <li>
        <button type="button" onClick={onScale} aria-label={`y axis scale: ${scale}`}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: muted, fontSize: 11 }}>
          {SCALE_MODES.map((m, i) => (
            <span key={m}>
              {i > 0 && <span style={{ opacity: 0.5 }}> / </span>}
              <span style={{ color: m === scale ? accent : muted, fontWeight: m === scale ? 600 : 400 }}>{m}</span>
            </span>
          ))}
        </button>
      </li>
    </ul>
  );
}

/**
 * "tracking began Sep 3", at the top of the plot with a halo behind it.
 *
 * At the bottom — where it was — it landed exactly on the channel's typical curve, which in the
 * first hours of a video's life is flat and near the floor: on Matt Wolfe's GPT-6 video the
 * words and the grey line were the same pixels. Top of the plot, and a rect in the surface
 * token behind the text so nothing that crosses that height ever runs through the letters.
 * Where it sits (and which side of the rule it is written on) is chart-style's decision.
 */
function TrackingLabel({ viewBox, text, muted, surface, flip }: {
  viewBox?: { x?: number; y?: number }; text: string; muted: string; surface: string; flip: boolean;
}) {
  const x = viewBox?.x ?? 0;
  const y = (viewBox?.y ?? 0) + 13;
  const w = text.length * 5.6 + 8;          // 11px system text, near enough for a halo
  const left = flip ? x - 4 - w : x + 4;
  return (
    <g aria-hidden>
      <rect x={left} y={y - 9.5} width={w} height={13} rx={3} fill={surface} fillOpacity={0.92} />
      <text x={left + 4} y={y} fontSize={CHART_TYPE.label} fill={muted}>{text}</text>
    </g>
  );
}

/**
 * The chips above the plot: the brush window, preset. Values only — "6h", "24h", "7d" — because
 * a chip that says "last 24 hours" is three words where one is enough. The lit one is filled.
 */
function RangeChips({ chips, active, muted, accent, line, surface, onPick }: {
  chips: ReturnType<typeof rangeChips>; active: string | null;
  muted: string; accent: string; line: string; surface: string;
  onPick: (key: string) => void;
}) {
  if (!chips.length) return null;
  const chip = (on: boolean): React.CSSProperties => ({
    font: 'inherit', fontSize: CHART_TYPE.label, lineHeight: '20px', padding: '0 9px', cursor: 'pointer',
    borderRadius: 999, border: `1px solid ${on ? accent : line}`,
    background: on ? accent : 'none', color: on ? surface : muted, fontWeight: on ? 600 : 400,
  });
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 6 }}>
      {chips.map((c) => (
        <button key={c.key} type="button" style={chip(active === c.key)} aria-pressed={active === c.key}
                onClick={() => onPick(c.key)}>
          {c.key}
        </button>
      ))}
    </div>
  );
}

/**
 * The timeline handle — the control Brandon asked for, and the only way to change the viewport
 * apart from the chips.
 *
 * A slim mini-map of this video's own line across the WHOLE domain (solid where we counted,
 * dashed where we are forecasting), everything outside the window washed back into the plate,
 * and on top of it three targets: two edge handles that resize and the window between them
 * that pans. Double-click the track for the whole domain back.
 *
 * The three things this component owns that a pure function cannot:
 *
 *   - Pointer CAPTURE. Without it a drag that leaves the track keeps painting the page blue and
 *     the window stops following the finger. With it the gesture belongs to the handle from
 *     pointerdown to pointerup, which is what makes it feel like a control rather than a guess.
 *   - The track's pixel width, which only the DOM knows (ResizeObserver).
 *   - Focus. The handles are real <button>s over the paint layer, so they tab, they show the
 *     app's own focus ring, and the arrow keys reach every window the pointer can.
 *
 * Where a dragged handle is ALLOWED to stop is not here — that is lib/app/chart-brush.ts.
 */
function BrushTrack({ full, view, onView, points, C }: {
  full: [number, number];
  view: [number, number];
  onView: (v: [number, number] | null) => void;
  points: SeriesPoint[];
  C: { ink: string; muted: string; line: string; accent: string; surface: string };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [grabbed, setGrabbed] = useState<Edge | 'window' | null>(null);
  const gesture = useRef<{ part: Edge | 'window'; originPx: number; from: [number, number] } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(el.getBoundingClientRect().width);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const localX = (e: React.PointerEvent) => e.clientX - (ref.current?.getBoundingClientRect().left ?? 0);

  const begin = (part: Edge | 'window') => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    gesture.current = { part, originPx: localX(e), from: view };
    setGrabbed(part);
  };
  const move = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || !width) return;
    const px = localX(e);
    onView(g.part === 'window'
      ? panWindow(px - g.originPx, g.from, full, width)
      : dragEdge(g.part, px, g.from, full, width));
  };
  const end = (e: React.PointerEvent) => {
    if (gesture.current) {
      try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch {}
    }
    gesture.current = null;
    setGrabbed(null);
  };

  const key = (edge: Edge) => (e: React.KeyboardEvent) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir || !width) return;
    e.preventDefault();
    onView(nudgeEdge(edge, dir as -1 | 1, view, full, width));
  };

  const rect = windowRect(view, full, width);
  const paths = useMemo(
    () => brushPaths(points as any, full, width, BRUSH_HEIGHT),
    [points, full, width]
  );
  const F = seriesStyle('forecast');
  const whole = isFullDomain(view, full);

  const handle = (edge: Edge, x: number) => (
    <button
      key={edge} type="button"
      aria-label={edge} aria-valuemin={full[0]} aria-valuemax={full[1]}
      aria-valuenow={edge === 'start' ? view[0] : view[1]} role="slider"
      onPointerDown={begin(edge)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      onKeyDown={key(edge)} onDoubleClick={(e) => { e.stopPropagation(); onView(null); }}
      style={{
        position: 'absolute', top: -2, height: BRUSH_HEIGHT + 4,
        left: x - HANDLE_HIT / 2, width: HANDLE_HIT,
        padding: 0, border: 'none', background: 'none', cursor: 'col-resize',
        touchAction: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {/* The grip: the ink of the handle, narrower than the target that catches the pointer. */}
      <span aria-hidden style={{
        display: 'block', width: HANDLE_WIDTH, height: BRUSH_HEIGHT,
        borderRadius: 3, background: C.accent,
        boxShadow: `inset 0 0 0 1px ${C.surface}, inset 2px 0 0 -1px ${C.surface}, inset -2px 0 0 -1px ${C.surface}`,
      }} />
    </button>
  );

  return (
    <div style={{ paddingLeft: PLOT_INSET.left, paddingRight: PLOT_INSET.right, marginTop: 2 }}>
      <div
        ref={ref}
        onDoubleClick={() => onView(null)}
        style={{ position: 'relative', height: BRUSH_HEIGHT, touchAction: 'none', userSelect: 'none' }}
      >
        <svg width="100%" height={BRUSH_HEIGHT} style={{ display: 'block', pointerEvents: 'none' }} aria-hidden>
          <rect x={0} y={0} width="100%" height={BRUSH_HEIGHT} rx={4} fill={C.line} fillOpacity={0.25} />
          {paths.dashed && (
            <path d={paths.dashed} fill="none" stroke={C.accent} strokeWidth={1}
                  strokeDasharray={F.dash} strokeOpacity={0.7} />
          )}
          {paths.solid && <path d={paths.solid} fill="none" stroke={C.accent} strokeWidth={1.25} />}
          {/* Outside the window, washed back — far enough that the window reads as the subject,
              not so far that the shape disappears: a mini-map you cannot see is not a map. */}
          {!whole && (
            <>
              <rect x={0} y={0} width={Math.max(rect.x, 0)} height={BRUSH_HEIGHT} rx={4}
                    fill={C.surface} fillOpacity={0.6} />
              <rect x={rect.x + rect.w} y={0} width={Math.max(width - rect.x - rect.w, 0)} height={BRUSH_HEIGHT}
                    rx={4} fill={C.surface} fillOpacity={0.6} />
            </>
          )}
          <rect x={rect.x} y={0.5} width={rect.w} height={BRUSH_HEIGHT - 1} rx={3}
                fill={C.accent} fillOpacity={0.06} stroke={C.accent} strokeOpacity={0.45} strokeWidth={1} />
        </svg>

        <div
          onPointerDown={begin('window')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
          style={{
            position: 'absolute', top: 0, height: BRUSH_HEIGHT,
            left: rect.x + HANDLE_HIT / 2, width: Math.max(rect.w - HANDLE_HIT, 0),
            cursor: grabbed === 'window' ? 'grabbing' : 'grab', touchAction: 'none',
          }}
        />
        {width > 0 && handle('start', rect.x)}
        {width > 0 && handle('end', rect.x + rect.w)}
      </div>
    </div>
  );
}

export default function VideoChartPlot({
  actuals, curve, series, marks, score, publishedAt,
}: {
  publishedAt?: string | Date | null;
  actuals: Actual[];
  curve: CurvePoint[];
  /** One value per day with its kind; kind decides styling, never whether a value exists. */
  series: SeriesPoint[];
  /** The packaging groups on the day axis — lib/app/packaging-groups.ts, the strip's own call. */
  marks: PackagingMark[];
  score: number | null;
}) {
  const { hovered, setHovered, setOpened } = useMarkerHover();
  const C = useThemeColors();
  const [scale, setScale] = useState<ScaleMode>(SCALE_MODES[0]);

  const rows = useMemo(() => chartRows(series, curve, actuals), [actuals, curve, series]);
  // The right edge is the series' own last day — the horizon lib/app/chart-horizon.ts chose.
  // It used to be floored at 1, which quietly overrode a six-hour horizon with a full day and
  // put the hour-old launch back in the leftmost tenth of the plate. The floor is only there
  // for an empty chart, which has no last day at all.
  const maxDay = rows.length ? Math.max(...rows.map((r) => r.day)) : 1;
  const full = useMemo<[number, number]>(() => [0, maxDay], [maxDay]);

  // The zoom is a VIEWPORT over the same rows: nothing is recomputed, refetched or re-fitted
  // when the reader drags, so what they zoom into is the line they were already looking at.
  const [view, setView] = useState<[number, number] | null>(null);
  const domain = view ?? full;

  /** Every window the brush produces goes through chart-brush's invariants on its way in. */
  const setWindow = useCallback((next: [number, number] | null) => {
    if (!next) return setView(null);
    const w = clampWindow(next, full);
    setView(isFullDomain(w, full) ? null : w);
  }, [full]);

  // The chips are the brush's window preset. Which of them are worth offering, what each one
  // means as a window, and which one the current window IS are all chart-zoom's decisions — a
  // window the reader brushed by hand lands on none of them and lights none.
  const chips = useMemo(() => rangeChips(full), [full]);
  const active = useMemo(() => activeChip(domain, full), [domain, full]);
  const pickChip = (key: string) => {
    const c = chips.find((x) => x.key === key);
    if (!c) return;
    setWindow(chipViewport(c, full));
  };
  const ticks = useMemo(() => axisTicks(domain), [domain]);
  const launch = domain[1] - domain[0] <= 3;
  const laid = useMemo(() => markerLayout(marks, domain), [marks, domain]);
  /**
   * A click on a test window opens that test in the strip below and scrolls to it. recharts
   * reports a click as an x value rather than "you hit this ReferenceArea", so the hit test is
   * ours (lib/app/chart-marks.markAt) — which also means the shading, the chip and the line
   * inside the window all behave as the one target the reader was aiming at.
   */
  const onClick = (e: any) => {
    if (e?.activeLabel == null) return;
    const hit = markAt(laid, Number(e.activeLabel), domain);
    if (hit) setOpened(hit.groupKeys[0] ?? null);
  };

  // Which part of the line the cursor is on. The boundary rows carry their neighbour's keys so
  // the segments meet, so "the row has a band" is NOT the same question as "this is a forecast"
  // — asking the row was what put "likely" and "range" under a measurement we actually counted.
  const kindByDay = useMemo(() => new Map(series.map((p) => [p.day, p.kind] as const)), [series]);

  const S = { measured: seriesStyle('measured'), implied: seriesStyle('implied'), forecast: seriesStyle('forecast') };
  const stroke = (t: 'accent' | 'muted') => (t === 'accent' ? C.accent : C.muted);
  const firstMeasuredDay = series.find((p) => p.kind === 'measured')?.day ?? null;
  const trackingBegan = trackingBeganLabel(publishedAt ?? null, firstMeasuredDay);
  const trackingAt = trackingLabelPlacement(firstMeasuredDay, domain[1]);
  const hasImplied = series.some((p) => p.kind === 'implied');
  const hasMeasured = series.some((p) => p.kind === 'measured');
  const hasForecast = series.some((p) => p.kind === 'forecast');

  // The end labels belong to the horizon, so they are drawn only when the horizon is in view.
  const inView = (d: number) => d >= domain[0] && d <= domain[1];
  const endBaseline = curve.length && inView(curve[curve.length - 1].day) ? curve[curve.length - 1] : null;
  const lastSeries = series.length ? series[series.length - 1] : null;
  const endProjected = lastSeries && inView(lastSeries.day) ? { day: lastSeries.day, projected: lastSeries.views } : null;
  /**
   * Where the video IS. The chart drew the horizon's projection with a value on it and left the
   * last thing we actually counted as an unmarked bend in the line — the one number on this
   * plate the reader can act on, unlabelled. It is a filled dot with its value, and it is the
   * only dot on the measured line at rest.
   */
  const lastMeasured = useMemo(() => {
    for (let i = series.length - 1; i >= 0; i--) if (series[i].kind === 'measured') return series[i];
    return null;
  }, [series]);
  const nowPoint = lastMeasured && inView(lastMeasured.day) ? lastMeasured : null;
  /** Day 30 is the number the score is written against, so it is named where it happens. */
  const day30 = useMemo(
    () => series.find((p) => Math.abs(p.day - 30) < 1e-9 && p.kind === 'forecast') ?? null,
    [series]
  );
  const day30Point = day30 && inView(30) && (!endProjected || Math.abs(endProjected.day - 30) > 1e-9) ? day30 : null;

  // The y axis fits WHAT IS ON SCREEN, not the whole data set.
  //
  // `[0, 'auto']` let recharts scale to every row, horizon included: kUcMWnhDF4U at an hour old
  // had 1,446 views on an axis topped by the channel's typical curve at day 3 (148,000), so the
  // only line worth reading was flat on the floor. lib/app/chart-style.visibleYDomain is the
  // rule — measured, reconstruction, forecast median, drawn band and the typical line, inside
  // the current domain and nothing else. ('auto' remains the fallback for an empty view.)
  const fitted = useMemo(() => visibleYDomain(rows, domain, scale), [rows, domain, scale]);
  const yDomain: [any, any] = fitted ?? (scale === 'log' ? [1, 'auto'] : [0, 'auto']);
  // Round numbers, and no tick stranded in the 8% of headroom visibleYDomain leaves for the end
  // label. On a log axis recharts' own ticks are the powers, which is what a log axis is for.
  const yTicks = fitted && scale === 'linear' ? niceTicks(fitted) : null;

  // Nothing measured, nothing modelled, nothing to compare to: an empty plate says that. A
  // sentence about when snapshots begin is the page apologising to itself.
  if (!series.length && !actuals.length && !curve.length) return null;

  return (
    <div>
      <RangeChips chips={chips} active={active} muted={C.muted} accent={C.accent} line={C.line}
                  surface={C.surface} onPick={pickChip} />

      {/* Recharts sizes its legend wrapper from the legend's own content, which on a narrow
          screen is wider than the chart and would stretch the whole page. Clipping it here is
          what keeps the chart from giving the WHOLE PAGE a horizontal scrollbar at 375px. */}
      <div style={{ width: '100%', maxWidth: '100%', overflow: 'hidden', position: 'relative' }}>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart
          data={rows} margin={{ top: 22, right: PLOT_INSET.right, left: 4, bottom: 0 }}
          onClick={onClick}
        >
          {/* Horizontal only, and faint: the y ticks are round numbers now, so the grid is
              there to carry the eye across to them, not to be a second subject on the plate. */}
          <CartesianGrid vertical={false} stroke={C.line} strokeOpacity={0.6} strokeDasharray="0" />
          <XAxis
            dataKey="day" type="number" domain={domain} ticks={ticks} allowDataOverflow
            tick={{ fontSize: CHART_TYPE.tick, fill: C.muted }} stroke={C.line}
            tickFormatter={(d: number) => axisDate(publishedAt, Number(d), launch)}
            minTickGap={12}
          />
          <YAxis
            tick={{ fontSize: CHART_TYPE.tick, fill: C.muted }} stroke={C.line} width={52} tickFormatter={fmtViews}
            scale={scale} domain={yDomain} allowDataOverflow
            {...(yTicks ? { ticks: yTicks } : {})}
          />
          <Tooltip
            cursor={{ stroke: C.muted, strokeWidth: 1, strokeOpacity: 0.5, strokeDasharray: '3 3' }}
            content={({ active, payload, label }: any) => {
              if (!active || !payload?.length) return null;
              const row = payload[0]?.payload || {};
              const mine = row.dot ?? row.views ?? row.projected ?? row.implied;
              const t0 = publishedAt ? new Date(publishedAt).getTime() : NaN;
              const at = Number.isFinite(t0) ? new Date(t0 + Number(label) * 86_400_000) : new Date(NaN);
              // Three lines on a point we counted; the ranges belong to the forecast alone.
              const lines = tooltipLines({
                at, kind: (kindByDay.get(Number(label)) ?? 'measured') as TooltipKind,
                views: mine ?? null, typical: row.expected ?? null,
                inner: row.bandInner ?? null, outer: row.bandOuter ?? null,
              });
              return (
                <HoverCard C={C}>
                  {lines.map((l, i) => (
                    <div key={i} style={{ color: i === 1 ? C.ink : C.muted, fontWeight: i === 1 ? 600 : 400, marginTop: i === 2 ? 3 : 0 }}>{l}</div>
                  ))}
                </HoverCard>
              );
            }}
          />
          {/* One ribbon, the middle half. The 10–90 tail is still fitted and still said in the
              tooltip's last line; drawing both put two uncertainties on one plate. And the
              Area's activeDot is off — recharts lit dots on the band EDGES, quantiles drawn
              exactly like the measurements below them. (lib/app/chart-style.areaProps) */}
          {hasForecast && DRAWN_RINGS.map((ring) => (
            <Area key={ring} dataKey={ring === 'inner' ? 'bandInner' : 'bandOuter'} {...areaProps(ring, C.accent, C.mode)} />
          ))}

          {curve.length > 0 && (
            <Line
              dataKey="expected" name={SERIES_LABELS.expected} legendType="none" connectNulls dot={false} activeDot={false}
              stroke={C[TYPICAL_STYLE.strokeToken]} strokeWidth={TYPICAL_STYLE.width}
              strokeDasharray={TYPICAL_STYLE.dash} isAnimationActive={false}
            />
          )}
          {hasImplied && (
            <Line
              dataKey="implied" name={SERIES_LABELS.implied} legendType="none" connectNulls dot={false} activeDot={false}
              stroke={stroke(S.implied.strokeToken)} strokeWidth={S.implied.width}
              strokeDasharray={S.implied.dash} strokeOpacity={S.implied.opacity} isAnimationActive={false}
            />
          )}
          {hasForecast && (
            <Line
              dataKey="projected" name={SERIES_LABELS.forecast} legendType="none" connectNulls dot={false} activeDot={false}
              stroke={stroke(S.forecast.strokeToken)} strokeWidth={S.forecast.width}
              strokeDasharray={S.forecast.dash} strokeOpacity={S.forecast.opacity} isAnimationActive={false}
            />
          )}
          {hasMeasured && (
            /* connectNulls would bridge a gap between two measurements with a solid line —
               claiming we measured days we did not. The implied path already covers it. */
            <Line
              dataKey="views" name={SERIES_LABELS.measured} legendType="none" connectNulls={false} dot={false} activeDot={false}
              stroke={stroke(S.measured.strokeToken)} strokeWidth={S.measured.width} isAnimationActive={false}
            />
          )}
          {/* Nothing at rest: a dot appears under the cursor, at the nearest real measurement
              and nowhere else. A chart covered in dots said "we counted all of this". */}
          {hasMeasured && (
            <Line
              dataKey="dot" name="measured" connectNulls={false} stroke="none" strokeWidth={0} isAnimationActive={false}
              legendType="none" dot={false}
              activeDot={{ r: 3.5, fill: C.accent, stroke: C.surface, strokeWidth: 1.5 }}
            />
          )}

          {/* Without this the dotted stretch on the left reads as missing data rather than as
              "we were not watching yet". */}
          {trackingBegan && trackingAt && (
            <ReferenceLine
              x={trackingAt.x} stroke={C.muted} strokeWidth={1} strokeOpacity={0.35} strokeDasharray="2 3"
              label={<TrackingLabel text={trackingBegan} muted={C.muted} surface={C.surface}
                                    flip={trackingAt.position === 'insideTopRight'} />}
            />
          )}

          {endBaseline && (
            <ReferenceDot
              x={endBaseline.day} y={endBaseline.expected} r={3} fill={C.muted} stroke="none" isFront
              label={{ value: fmtViews(endBaseline.expected), fontSize: CHART_TYPE.label, fill: C.muted, position: 'left', offset: 10, dy: 12 }}
            />
          )}
          {endProjected && (
            <ReferenceDot
              x={endProjected.day} y={endProjected.projected} r={3} fill={C.accent} stroke="none" isFront
              label={{ value: fmtViews(endProjected.projected), fontSize: CHART_TYPE.label, fill: C.accent, position: 'left', offset: 10, dy: -12 }}
            />
          )}
          {endBaseline && endProjected && score != null && (
            <ReferenceLine
              segment={[{ x: endBaseline.day, y: endBaseline.expected }, { x: endProjected.day, y: endProjected.projected }]}
              stroke={C.ink} strokeWidth={1}
              label={{ value: `${score.toFixed(1)}×`, fontSize: CHART_TYPE.emphasis, fontWeight: 700, fill: C.ink, position: 'right' }}
            />
          )}

          {/* Where the video is now: the last count we took, with its number. */}
          {nowPoint && (
            <ReferenceDot
              x={nowPoint.day} y={nowPoint.views} r={4} fill={C.accent} stroke={C.surface} strokeWidth={1.5} isFront
              label={{ value: fmtViews(nowPoint.views), fontSize: CHART_TYPE.emphasis, fontWeight: 600,
                       fill: C.accent, position: 'top', offset: 8 }}
            />
          )}
          {day30Point && (
            <ReferenceDot
              x={30} y={day30Point.views} r={2.5} fill={C.accent} fillOpacity={0.6} stroke="none" isFront
              label={{ value: fmtViews(day30Point.views), fontSize: CHART_TYPE.label, fill: C.muted,
                       position: 'top', offset: 8 }}
            />
          )}

          {/* The packaging groups. A TEST is a shaded window from its first rotation to the
              settle — one experiment, however many state rows it wrote — and a single change
              is one rule. The grouping is the strip's own (lib/app/packaging-groups.ts); the
              layout, including which windows collapse at this zoom, is chart-marks. */}
          {laid.map((m) => {
            const on = m.markerKeys.some((k) => k === hovered);
            const isTest = m.kind === 'test' || m.kind === 'cluster';
            const color = isTest ? C.accent : C.ink;
            const handlers = {
              onMouseEnter: () => setHovered(m.markerKeys[0] ?? null),
              onMouseLeave: () => setHovered(null),
              onClick: () => setOpened(m.groupKeys[0] ?? null),
              style: { cursor: 'pointer' },
            } as any;
            const label = {
              value: m.chip, fontSize: CHART_TYPE.label, fill: color, fontWeight: on ? 700 : 500,
              position: m.chipAnchor === 'end' ? 'insideTopRight' : 'insideTopLeft',
              dx: m.chipAnchor === 'end' ? -4 : 4, dy: 4, ...handlers,
            } as any;
            return m.endDay != null && m.endDay > m.startDay ? (
              <ReferenceArea
                key={m.key} x1={m.startDay} x2={m.endDay} fill={color}
                fillOpacity={on ? 0.16 : 0.08} stroke={color} strokeOpacity={on ? 0.5 : 0.2}
                label={label} {...handlers}
              />
            ) : (
              <ReferenceLine
                key={m.key} x={m.chipX} stroke={color} strokeWidth={on ? 2 : 1}
                strokeOpacity={on ? 0.9 : 0.25} label={label} {...handlers}
              />
            );
          })}

        </ComposedChart>
      </ResponsiveContainer>

      {/* The handle on the timeline. It is inside the clipped container so it can never be the
          thing that gives the page a horizontal scrollbar. */}
      <BrushTrack full={full} view={domain} onView={setWindow} points={series} C={C} />

      {/* The legend reads LAST, under the control — recharts drew it between the axis and the
          brush, which put three names in the gap where the timeline handle belongs. */}
      <div style={{ marginTop: 8 }}>
        <ChartLegend
          entries={legendEntries({ video: hasMeasured || hasImplied, forecast: hasForecast, expected: curve.length > 0 })}
          accent={C.accent} muted={C.muted} mode={C.mode}
          scale={scale} onScale={() => setScale(nextScale(scale))}
        />
      </div>
      </div>
    </div>
  );
}
