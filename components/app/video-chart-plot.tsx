'use client';

// The recharts half of the video chart, split out so next/dynamic can keep ~1 MB of charting
// library off the video page's critical path. Everything that is not recharts — the hover
// context the packaging strip shares, the theme colours, the date formatting — stays in
// video-chart.tsx, which this imports.

import { useMemo, useState } from 'react';
import {
  Area, ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot, Legend,
} from 'recharts';
import { type Actual, type CurvePoint, type Marker } from '@/lib/admin/video-curve';
import type { SeriesPoint } from '@/lib/app/chart-series';
import { seriesStyle, chartRows, bandStyle, SERIES_LABELS, BAND_LABELS, trackingBeganLabel, trackingLabelPlacement, TYPICAL_STYLE, legendEntries } from '@/lib/app/chart-style';
import { Thumb } from './thumb';
import { markerKey, useMarkerHover, useThemeColors, fmtViews, axisDate, tooltipDate, dayLabel, type Zoom } from './video-chart';

const HOUR_TICKS = [0, 6, 12, 24, 48, 72];

/**
 * The legend, drawn by hand rather than by recharts.
 *
 * Two reasons. Order: recharts lists series in the order they are PAINTED, which put the
 * channel's curve first and the one line we actually measured last. And the swatch: the
 * forecast is the only series carrying uncertainty, so its swatch shows the ribbon — the same
 * two fills at the same opacities the chart uses — instead of a bare dash that says nothing
 * about the band it stands for. See chart-style.legendEntries for the order itself.
 */
function ChartLegend({ entries, accent, muted, mode }: {
  entries: ReturnType<typeof legendEntries>;
  accent: string; muted: string; mode: 'light' | 'dark';
}) {
  const styleFor = (key: string) =>
    key === 'expected'
      ? { color: muted, dash: TYPICAL_STYLE.dash, width: TYPICAL_STYLE.width, opacity: 1 }
      : (() => { const st = seriesStyle(key as any); return { color: accent, dash: st.dash, width: st.width, opacity: st.opacity }; })();
  return (
    <ul style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '4px 16px', margin: 0, padding: 0, listStyle: 'none' }}>
      {entries.map((e) => {
        const st = styleFor(e.key);
        return (
          <li key={e.key} style={{ display: 'flex', alignItems: 'center', gap: 6, color: muted, fontSize: 11 }}>
            <svg width={24} height={12} aria-hidden style={{ overflow: 'visible', flex: '0 0 auto' }}>
              {e.ribbon && (
                <>
                  <rect x={0} y={1} width={24} height={10} fill={accent} fillOpacity={bandStyle('outer', mode).fillOpacity} />
                  <rect x={0} y={3.5} width={24} height={5} fill={accent} fillOpacity={bandStyle('inner', mode).fillOpacity} />
                </>
              )}
              <line x1={0} y1={6} x2={24} y2={6} stroke={st.color} strokeWidth={st.width} strokeDasharray={st.dash} strokeOpacity={st.opacity} />
            </svg>
            <span>{e.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
const DAY_TICKS = [0, 1, 2, 3, 5, 7, 14, 21, 30, 45, 60, 90, 120, 180, 270, 365, 550, 730, 1095];

export default function VideoChartPlot({
  actuals, curve, series, markers, thumbUrls, score, defaultZoom = 'full', publishedAt,
}: {
  publishedAt?: string | Date | null;
  actuals: Actual[];
  curve: CurvePoint[];
  /** One value per day with its kind; kind decides styling, never whether a value exists. */
  series: SeriesPoint[];
  markers: Marker[];
  thumbUrls: Record<number, string>;
  score: number | null;
  defaultZoom?: Zoom;
}) {
  const { hovered, setHovered } = useMarkerHover();
  const [zoom, setZoom] = useState<Zoom>(defaultZoom);
  const C = useThemeColors();

  const all = useMemo(() => chartRows(series, curve, actuals), [actuals, curve, series]);

  const launch = zoom === '72h';
  const rows = launch ? all.filter((r) => r.day <= 3) : all;
  const maxDay = launch ? 3 : Math.max(...all.map((r) => r.day), 1);
  const minDay = 0;
  const endBaseline = launch || !curve.length ? null : curve[curve.length - 1];
  const lastSeries = series.length ? series[series.length - 1] : null;
  const endProjected = launch || !lastSeries ? null : { day: lastSeries.day, projected: lastSeries.views };
  const shown = markers.filter((m) => !launch || m.day <= 3);
  const ticks = launch
    ? HOUR_TICKS.map((h) => h / 24).filter((t) => t >= minDay - 1e-9)
    : DAY_TICKS.filter((t) => t <= maxDay * 1.001);
  const hoveredMarker = markers.find((m) => markerKey(m) === hovered) ?? null;
  // Changes inside ~2% of the visible range share one tick, so a burst of tests reads as one event.
  const clusters = useMemo(() => {
    const span = Math.max(maxDay - (launch ? minDay : 0), 0.01);
    const out: Array<{ day: number; n: number; keys: string[]; kinds: Set<string> }> = [];
    for (const m of [...shown].sort((a, b) => a.day - b.day)) {
      const last = out[out.length - 1];
      if (last && m.day - last.day < span * 0.02) { last.n++; last.keys.push(markerKey(m)); last.kinds.add(m.kind); }
      else out.push({ day: m.day, n: 1, keys: [markerKey(m)], kinds: new Set([m.kind]) });
    }
    return out;
  }, [shown, maxDay, minDay, launch]);
  // Labels collide when two changes sit close together on a narrow chart, so a cluster keeps
  // its word only if it is far enough from the last labelled one. The ticks always stay.
  const labelled = useMemo(() => {
    const span = Math.max(maxDay - (launch ? minDay : 0), 0.01);
    const keep = new Set<string>();
    let lastAt = -Infinity;
    for (const cl of clusters) {
      if (keep.size >= 3) break;
      if (cl.day - lastAt < span * 0.14) continue;
      keep.add(cl.keys[0]);
      lastAt = cl.day;
    }
    return keep;
  }, [clusters, maxDay, minDay, launch]);
  const S = { measured: seriesStyle('measured'), implied: seriesStyle('implied'), forecast: seriesStyle('forecast') };
  const stroke = (t: 'accent' | 'muted') => (t === 'accent' ? C.accent : C.muted);
  const firstMeasuredDay = series.find((p) => p.kind === 'measured')?.day ?? null;
  const trackingBegan = trackingBeganLabel(publishedAt ?? null, firstMeasuredDay);
  // Drawn in BOTH zooms — the 72h view is the one that shows the launch this label explains —
  // and clamped inside the plot so a first measurement past the right edge still says so.
  const trackingAt = trackingLabelPlacement(firstMeasuredDay, maxDay);
  const hasImplied = series.some((p) => p.kind === 'implied');
  const hasMeasured = series.some((p) => p.kind === 'measured');
  const hasForecast = series.some((p) => p.kind === 'forecast');

  if (!series.length && !actuals.length && !curve.length) {
    return <p style={{ color: 'var(--cs-muted)', fontSize: 13 }}>No view data yet — the first snapshot lands within a day of publish.</p>;
  }
  // A channel with no baseline yet has no expected curve and no band. Draw the actual
  // series on its own and say so, rather than leaving the reader to wonder what is missing.
  const noBaseline = !curve.length;

  return (
    <div>
      {defaultZoom === '72h' && (
        <div className="cs-chips" style={{ marginBottom: 10 }}>
          {(['72h', 'full'] as Zoom[]).map((z) => (
            <button key={z} type="button" className="cs-chip" data-on={zoom === z} aria-pressed={zoom === z} onClick={() => setZoom(z)}>
              {z === '72h' ? 'First 72h' : 'Since publish'}
            </button>
          ))}
        </div>
      )}

      {/* Recharts sizes its legend wrapper from the legend's own content, which on a narrow
          screen is wider than the chart and would stretch the whole page. Clip it here. */}
      <div style={{ width: '100%', maxWidth: '100%', overflow: 'hidden' }}>
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={rows} margin={{ top: 20, right: 58, left: 4, bottom: 0 }}>
          <XAxis
            dataKey="day" type="number" domain={[0, maxDay]} ticks={ticks} allowDataOverflow
            tick={{ fontSize: 11, fill: C.muted }} stroke={C.line}
            tickFormatter={(d: number) => axisDate(publishedAt, Number(d), launch)}
            minTickGap={12}
          />
          <YAxis tick={{ fontSize: 11, fill: C.muted }} stroke={C.line} width={52} tickFormatter={fmtViews} />
          <Tooltip
            content={({ active, payload, label }: any) => {
              if (!active || !payload?.length) return null;
              const row = payload[0]?.payload || {};
              const mine = row.dot ?? row.views ?? row.projected ?? row.implied;
              return (
                <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 8, padding: '8px 10px', fontSize: 12, color: C.ink }}>
                  <div style={{ color: C.muted, marginBottom: 4 }}>{tooltipDate(publishedAt, Number(label))}</div>
                  {mine != null && <div style={{ color: C.accent, fontWeight: 600 }}>{fmtViews(Number(mine))} views</div>}
                  {row.expected != null && <div style={{ color: C.muted }}>typical {fmtViews(Number(row.expected))}</div>}
                  {row.bandInner && (
                    <div style={{ color: C.muted, marginTop: 3 }}>
                      {BAND_LABELS.inner}: {fmtViews(row.bandInner[0])}–{fmtViews(row.bandInner[1])}
                    </div>
                  )}
                  {row.bandOuter && (
                    <div style={{ color: C.muted }}>
                      {BAND_LABELS.outer}: {fmtViews(row.bandOuter[0])}–{fmtViews(row.bandOuter[1])}
                    </div>
                  )}
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
              />
            )}
          />
          {/* Recharts puts every declared series in the legend whether or not it has data, so
              each one is mounted only in the states where it actually draws something. */}
          {/* The channel's typical curve is a LINE and nothing else — its grey ribbon used to sit
              here, and two bands on one chart made the reader work out whose uncertainty was
              whose. The only thing this page is uncertain about is what happens next.

              Two ribbons on the forecast: the middle half solid enough to read as the claim,
              the 10-90 tail faint behind it. Outer first so the inner paints on top. */}
          {hasForecast && (
            <Area dataKey="bandOuter" name={BAND_LABELS.outer} connectNulls stroke="none" fill={C.accent} fillOpacity={bandStyle('outer', C.mode).fillOpacity} isAnimationActive={false} legendType="none" />
          )}
          {hasForecast && (
            <Area dataKey="bandInner" name={BAND_LABELS.inner} connectNulls stroke="none" fill={C.accent} fillOpacity={bandStyle('inner', C.mode).fillOpacity} isAnimationActive={false} legendType="none" />
          )}
          {curve.length > 0 && (
            <Line
              dataKey="expected" name={SERIES_LABELS.expected} legendType="none" connectNulls dot={false}
              stroke={C[TYPICAL_STYLE.strokeToken]} strokeWidth={TYPICAL_STYLE.width}
              strokeDasharray={TYPICAL_STYLE.dash} isAnimationActive={false}
            />
          )}
          {/* Days before we were watching, and any gap longer than MEASURED_GAP_DAYS. Muted and
              dotted, with no band: it is a reconstruction of something that already happened,
              and an uncertainty ribbon would make it read as a projection. */}
          {hasImplied && (
            <Line
              dataKey="implied" name={SERIES_LABELS.implied} legendType="none" connectNulls dot={false}
              stroke={stroke(S.implied.strokeToken)} strokeWidth={S.implied.width}
              strokeDasharray={S.implied.dash} strokeOpacity={S.implied.opacity} isAnimationActive={false}
            />
          )}
          {hasForecast && (
            <Line
              dataKey="projected" name={SERIES_LABELS.forecast} legendType="none" connectNulls dot={false}
              stroke={stroke(S.forecast.strokeToken)} strokeWidth={S.forecast.width}
              strokeDasharray={S.forecast.dash} strokeOpacity={S.forecast.opacity} isAnimationActive={false}
            />
          )}
          {hasMeasured && (
            /* connectNulls would bridge a gap between two measurements with a solid line —
               claiming we measured days we did not. The implied path already covers it. */
            <Line
              dataKey="views" name={SERIES_LABELS.measured} legendType="none" connectNulls={false} dot={false}
              stroke={stroke(S.measured.strokeToken)} strokeWidth={S.measured.width} isAnimationActive={false}
            />
          )}
          {/* The real measurements as points — a video with one or two snapshots is otherwise a
              model path with nothing of its own on it. */}
          {hasMeasured && actuals.length <= 6 && (
            <Line
              dataKey="dot" name="measured" connectNulls={false} stroke={C.accent} strokeWidth={0} isAnimationActive={false}
              legendType="none"
              dot={{ r: 3.5, fill: C.accent, stroke: C.surface, strokeWidth: 1.5 }}
              activeDot={{ r: 4, fill: C.accent }}
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

          {clusters.map((cl) => {
            const on = cl.keys.some((k) => k === hovered);
            const color = cl.kinds.has('thumb') ? C.accent : C.ink;
            const label = cl.n === 1 ? (cl.kinds.has('thumb') ? 'swap' : 'title') : `${cl.n} swaps`;
            return (
              <ReferenceLine
                key={cl.keys[0]}
                x={cl.day}
                stroke={color}
                strokeWidth={on ? 2 : 1}
                strokeOpacity={on ? 0.9 : 0.25}
                label={labelled.has(cl.keys[0]) || on
                  ? ({ value: label, fontSize: 10, fill: color, position: 'insideTopRight', dx: 4, dy: 6,
                      onMouseEnter: () => setHovered(cl.keys[0]), onMouseLeave: () => setHovered(null) } as any)
                  : undefined}
              />
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
      </div>

      {noBaseline && (
        <p style={{ color: 'var(--cs-muted)', fontSize: 12, marginTop: 8 }}>
          Baseline not available yet — showing this video&rsquo;s own views.
        </p>
      )}

      {hoveredMarker && (
        <div className="cs-note" style={{ marginTop: 10 }}>
          <div style={{ color: 'var(--cs-muted)', fontSize: 12, marginBottom: 8 }}>
            {hoveredMarker.kind === 'thumb' ? 'Thumbnail' : 'Title'} v{hoveredMarker.fromVersion} → v{hoveredMarker.version} at {dayLabel(hoveredMarker.day)}
          </div>
          {hoveredMarker.kind === 'thumb' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {[hoveredMarker.fromVersion, hoveredMarker.version].map((v, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {i === 1 && <span aria-hidden className="cs-arrow">→</span>}
                  <Thumb src={v != null ? thumbUrls[v] : null} alt={`thumbnail v${v}`} caption={`v${v}`} style={{ width: 160 }} />
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
