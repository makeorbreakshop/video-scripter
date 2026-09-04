'use client';

// The recharts half of the video chart, split out so next/dynamic can keep ~1 MB of charting
// library off the video page's critical path. Everything that is not recharts — the hover
// context the packaging strip shares, the theme colours, the date formatting — stays in
// video-chart.tsx, which this imports.
//
// v2, 2026-09-04: ONE continuous view. The "First 72h / Since publish" chips are gone; the
// reader drags across the part they care about and double-clicks to come back, over the same
// series either way. Every decision this file makes about what that means — the horizon, the
// ticks, which packaging groups collapse, what the tooltip says, whether the ribbon draws dots
// — lives in a pure module under lib/app and is asserted there. What is left here is wiring.

import { useMemo, useState } from 'react';
import {
  Area, ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot,
  ReferenceArea, Legend,
} from 'recharts';
import { type Actual, type CurvePoint, type Marker } from '@/lib/admin/video-curve';
import type { SeriesPoint } from '@/lib/app/chart-series';
import type { PackagingMark } from '@/lib/app/packaging-groups';
import {
  seriesStyle, chartRows, bandStyle, SERIES_LABELS, trackingBeganLabel, trackingLabelPlacement,
  TYPICAL_STYLE, legendEntries, areaProps, DRAWN_RINGS, SCALE_MODES, nextScale, tooltipLines,
  BAND_FOOTNOTE, visibleYDomain, type ScaleMode,
} from '@/lib/app/chart-style';
import { markerLayout, markAt } from '@/lib/app/chart-marks';
import { zoomDomain, axisTicks, isFullDomain } from '@/lib/app/chart-zoom';
import { Thumb } from './thumb';
import { markerKey, useMarkerHover, useThemeColors, fmtViews, axisDate, dayLabel } from './video-chart';

/**
 * The legend, drawn by hand rather than by recharts.
 *
 * Two reasons. Order: recharts lists series in the order they are PAINTED, which put the
 * channel's curve first and the one line we actually measured last. And the swatch: the
 * forecast is the only series carrying uncertainty, so its swatch shows the ribbon — the same
 * fill at the same opacity the chart uses — instead of a bare dash that says nothing about the
 * band it stands for. See chart-style.legendEntries for the order itself.
 *
 * The scale toggle sits at its right end, and the odds wording — said inside every tooltip
 * before, twice — is one footnote underneath.
 */
function ChartLegend({ entries, accent, muted, mode, scale, onScale }: {
  entries: ReturnType<typeof legendEntries>;
  accent: string; muted: string; mode: 'light' | 'dark';
  scale: ScaleMode; onScale: () => void;
}) {
  const styleFor = (key: string) =>
    key === 'expected'
      ? { color: muted, dash: TYPICAL_STYLE.dash, width: TYPICAL_STYLE.width, opacity: 1 }
      : (() => { const st = seriesStyle(key as any); return { color: accent, dash: st.dash, width: st.width, opacity: st.opacity }; })();
  return (
    <div style={{ display: 'grid', gap: 4, justifyItems: 'center' }}>
      <ul style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: '4px 16px', margin: 0, padding: 0, listStyle: 'none' }}>
        {entries.map((e) => {
          const st = styleFor(e.key);
          return (
            <li key={e.key} style={{ display: 'flex', alignItems: 'center', gap: 6, color: muted, fontSize: 11 }}>
              <svg width={24} height={12} aria-hidden style={{ overflow: 'visible', flex: '0 0 auto' }}>
                {e.ribbon && <rect x={0} y={2.5} width={24} height={7} fill={accent} fillOpacity={bandStyle('inner', mode).fillOpacity} />}
                <line x1={0} y1={6} x2={24} y2={6} stroke={st.color} strokeWidth={st.width} strokeDasharray={st.dash} strokeOpacity={st.opacity} />
              </svg>
              <span>{e.label}</span>
            </li>
          );
        })}
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
      <p style={{ margin: 0, fontSize: 10, color: muted, opacity: 0.85, textAlign: 'center' }}>{BAND_FOOTNOTE}</p>
    </div>
  );
}

export default function VideoChartPlot({
  actuals, curve, series, markers, marks, thumbUrls, score, publishedAt,
}: {
  publishedAt?: string | Date | null;
  actuals: Actual[];
  curve: CurvePoint[];
  /** One value per day with its kind; kind decides styling, never whether a value exists. */
  series: SeriesPoint[];
  markers: Marker[];
  /** The packaging groups on the day axis — lib/app/packaging-groups.ts, the strip's own call. */
  marks: PackagingMark[];
  thumbUrls: Record<number, string>;
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
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);

  const onDown = (e: any) => { if (e?.activeLabel != null) setDrag({ from: Number(e.activeLabel), to: Number(e.activeLabel) }); };
  const onMove = (e: any) => { if (drag && e?.activeLabel != null) setDrag({ ...drag, to: Number(e.activeLabel) }); };
  const onUp = () => {
    if (drag) {
      const next = zoomDomain(drag.from, drag.to, full);
      if (next) setView(next);
    }
    setDrag(null);
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

  const hoveredMarker = markers.find((m) => markerKey(m) === hovered) ?? null;

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

  // The y axis fits WHAT IS ON SCREEN, not the whole data set.
  //
  // `[0, 'auto']` let recharts scale to every row, horizon included: kUcMWnhDF4U at an hour old
  // had 1,446 views on an axis topped by the channel's typical curve at day 3 (148,000), so the
  // only line worth reading was flat on the floor. lib/app/chart-style.visibleYDomain is the
  // rule — measured, reconstruction, forecast median, drawn band and the typical line, inside
  // the current domain and nothing else. ('auto' remains the fallback for an empty view.)
  const fitted = useMemo(() => visibleYDomain(rows, domain, scale), [rows, domain, scale]);
  const yDomain: [any, any] = fitted ?? (scale === 'log' ? [1, 'auto'] : [0, 'auto']);

  if (!series.length && !actuals.length && !curve.length) {
    return <p style={{ color: 'var(--cs-muted)', fontSize: 13 }}>No view data yet — the first snapshot lands within a day of publish.</p>;
  }
  const noBaseline = !curve.length;

  return (
    <div>
      {/* Recharts sizes its legend wrapper from the legend's own content, which on a narrow
          screen is wider than the chart and would stretch the whole page. Clip it here. */}
      <div style={{ width: '100%', maxWidth: '100%', overflow: 'hidden' }}>
      <ResponsiveContainer width="100%" height={340}>
        <ComposedChart
          data={rows} margin={{ top: 22, right: 58, left: 4, bottom: 0 }}
          onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={() => setDrag(null)}
          onClick={onClick}
          onDoubleClick={() => setView(null)}
        >
          <XAxis
            dataKey="day" type="number" domain={domain} ticks={ticks} allowDataOverflow
            tick={{ fontSize: 11, fill: C.muted }} stroke={C.line}
            tickFormatter={(d: number) => axisDate(publishedAt, Number(d), launch)}
            minTickGap={12}
          />
          <YAxis
            tick={{ fontSize: 11, fill: C.muted }} stroke={C.line} width={52} tickFormatter={fmtViews}
            scale={scale} domain={yDomain} allowDataOverflow
          />
          <Tooltip
            content={({ active, payload, label }: any) => {
              if (!active || !payload?.length) return null;
              const row = payload[0]?.payload || {};
              const mine = row.dot ?? row.views ?? row.projected ?? row.implied;
              const t0 = publishedAt ? new Date(publishedAt).getTime() : NaN;
              const at = Number.isFinite(t0) ? new Date(t0 + Number(label) * 86_400_000) : new Date(NaN);
              // Four lines at most, and the odds words are a footnote under the legend now.
              const lines = tooltipLines({
                at, views: mine ?? null, typical: row.expected ?? null,
                inner: row.bandInner ?? null, outer: row.bandOuter ?? null,
              });
              return (
                <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 8, padding: '8px 10px', fontSize: 12, color: C.ink }}>
                  {lines.map((l, i) => (
                    <div key={i} style={{ color: i === 1 ? C.ink : C.muted, fontWeight: i === 1 ? 600 : 400, marginTop: i === 2 ? 3 : 0 }}>{l}</div>
                  ))}
                </div>
              );
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, color: C.muted, width: '100%', maxWidth: '100%' }}
            content={() => (
              <ChartLegend
                entries={legendEntries({ measured: hasMeasured, implied: hasImplied, forecast: hasForecast, expected: curve.length > 0 })}
                accent={C.accent} muted={C.muted} mode={C.mode}
                scale={scale} onScale={() => setScale(nextScale(scale))}
              />
            )}
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
              label={{ value: trackingBegan, fontSize: 10, fill: C.muted, position: trackingAt.position,
                dx: trackingAt.position === 'insideBottomLeft' ? 4 : -4, dy: -4 }}
            />
          )}

          {endBaseline && (
            <ReferenceDot
              x={endBaseline.day} y={endBaseline.expected} r={3} fill={C.muted} stroke="none" isFront
              label={{ value: fmtViews(endBaseline.expected), fontSize: 11, fill: C.muted, position: 'left', offset: 10, dy: 12 }}
            />
          )}
          {endProjected && (
            <ReferenceDot
              x={endProjected.day} y={endProjected.projected} r={3} fill={C.accent} stroke="none" isFront
              label={{ value: fmtViews(endProjected.projected), fontSize: 11, fill: C.accent, position: 'left', offset: 10, dy: -12 }}
            />
          )}
          {endBaseline && endProjected && score != null && (
            <ReferenceLine
              segment={[{ x: endBaseline.day, y: endBaseline.expected }, { x: endProjected.day, y: endProjected.projected }]}
              stroke={C.ink} strokeWidth={1}
              label={{ value: `${score.toFixed(1)}×`, fontSize: 12, fontWeight: 700, fill: C.ink, position: 'right' }}
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
              value: m.chip, fontSize: 10, fill: color, fontWeight: on ? 700 : 500,
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

          {/* What the reader is dragging over, while they drag. */}
          {drag && drag.from !== drag.to && (
            <ReferenceArea x1={Math.min(drag.from, drag.to)} x2={Math.max(drag.from, drag.to)}
                           fill={C.ink} fillOpacity={0.06} stroke="none" />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      </div>

      {!isFullDomain(domain, full) && (
        <p style={{ fontSize: 11, color: 'var(--cs-muted)', marginTop: 6 }}>
          <button type="button" onClick={() => setView(null)}
                  style={{ background: 'none', border: 'none', padding: 0, color: 'var(--cs-accent)', cursor: 'pointer', font: 'inherit' }}>
            reset zoom
          </button>
          <span> · or double-click the chart</span>
        </p>
      )}

      {noBaseline && (
        <p style={{ color: 'var(--cs-muted)', fontSize: 12, marginTop: 8 }}>
          Baseline not available yet — showing this video&rsquo;s own views.
        </p>
      )}

      {hoveredMarker && (
        <div className="cs-note" style={{ marginTop: 10 }}>
          <div style={{ color: 'var(--cs-muted)', fontSize: 12, marginBottom: 8 }}>
            {hoveredMarker.kind === 'thumb' ? 'Thumbnail' : 'Title'} detected at {dayLabel(hoveredMarker.day)}
          </div>
          {hoveredMarker.kind === 'thumb' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {[hoveredMarker.fromVersion, hoveredMarker.version].map((v, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {i === 1 && <span aria-hidden className="cs-arrow">→</span>}
                  <Thumb src={v != null ? thumbUrls[v] : null} alt={`thumbnail v${v}`} style={{ width: 120 }} />
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12 }}>
              <div style={{ color: 'var(--cs-muted)', textDecoration: 'line-through' }}>{hoveredMarker.from}</div>
              <div>{hoveredMarker.to}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
