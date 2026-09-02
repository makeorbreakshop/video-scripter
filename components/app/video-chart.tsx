'use client';

// The video's view curve, in the reader's terms: where it is now, where the model thinks it
// lands by day 30, and what a typical video on this channel would have done by then. The data
// is the admin chart's data — lib/admin/video-curve.ts is the only place the curve math lives.
//
// This file also owns the hover link between the chart and the packaging timeline below it:
// both draw the same markers, so hovering either highlights the other.

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  Area, ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot, Legend,
} from 'recharts';
import { aleAt, type Actual, type CurvePoint, type Marker, type ProjPoint } from '@/lib/admin/video-curve';
import { Thumb } from './thumb';

export function markerKey(m: { kind: string; version: number }) {
  return `${m.kind}-${m.version}`;
}

type HoverCtx = { hovered: string | null; setHovered: (k: string | null) => void };
const MarkerHover = createContext<HoverCtx>({ hovered: null, setHovered: () => {} });

/** Wrap the chart, the timeline and the experiment cards in this so hovering one highlights the rest. */
export function MarkerHoverProvider({ children }: { children: React.ReactNode }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const value = useMemo(() => ({ hovered, setHovered }), [hovered]);
  return <MarkerHover.Provider value={value}>{children}</MarkerHover.Provider>;
}

export function useMarkerHover() {
  return useContext(MarkerHover);
}

// Recharts writes colours into SVG attributes, where var() is unreliable, so read the theme's
// tokens once and again whenever the theme flips (the header toggle sets data-cs-theme).
// Only used for the first paint before the effect reads the real tokens; theme.css is the source of truth.
const FALLBACK = { ink: '#10131A', muted: '#5A6373', line: '#DDE2EA', accent: '#0E7A3C', surface: '#FFFFFF' };

export function useThemeColors() {
  const [c, setC] = useState(FALLBACK);
  useEffect(() => {
    const read = () => {
      const s = getComputedStyle(document.documentElement);
      const get = (n: string, fb: string) => s.getPropertyValue(n).trim() || fb;
      setC({
        ink: get('--cs-ink', FALLBACK.ink),
        muted: get('--cs-muted', FALLBACK.muted),
        line: get('--cs-line', FALLBACK.line),
        accent: get('--cs-accent', FALLBACK.accent),
        surface: get('--cs-surface', FALLBACK.surface),
      });
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-cs-theme'] });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', read);
    return () => { mo.disconnect(); mq.removeEventListener('change', read); };
  }, []);
  return c;
}

export function fmtViews(v: number) {
  return v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + 'K' : String(Math.round(v));
}

export function dayLabel(d: number) {
  return d < 1 ? `${Math.round(d * 24)}h` : `day ${d < 10 ? d.toFixed(d % 1 ? 1 : 0) : Math.round(d)}`;
}

export type Zoom = '72h' | 'full';
type Row = {
  day: number;
  expected?: number; band?: [number, number];
  projected?: number; implied?: number; impliedBand?: [number, number];
  views?: number; dot?: number;
};

const HOUR_TICKS = [0, 6, 12, 24, 48, 72];
const DAY_TICKS = [0, 1, 2, 3, 5, 7, 14, 21, 30, 45, 60, 90, 120, 180, 270, 365, 550, 730, 1095];

export function VideoChart({
  actuals, curve, projected, markers, thumbUrls, score, defaultZoom = 'full', sparse = false,
}: {
  actuals: Actual[];
  curve: CurvePoint[];
  projected: ProjPoint[];
  markers: Marker[];
  thumbUrls: Record<number, string>;
  score: number | null;
  defaultZoom?: Zoom;
  /** Too few real points to read a shape: draw the implied path across the whole range. */
  sparse?: boolean;
}) {
  const { hovered, setHovered } = useMarkerHover();
  const [zoom, setZoom] = useState<Zoom>(defaultZoom);
  const C = useThemeColors();

  const all = useMemo(() => {
    const byDay = new Map<number, Row>();
    const at = (d: number) => { let r = byDay.get(d); if (!r) { r = { day: d }; byDay.set(d, r); } return r; };
    for (const c of curve) Object.assign(at(c.day), { expected: c.expected, band: [c.lo, c.hi] as [number, number] });
    const clean = actuals.filter((a, i, arr) => {
      const prev = arr[i - 1], next = arr[i + 1];
      const spike = prev && next && a.views > prev.views * 1.03 && a.views > next.views * 1.03;
      return !spike;
    });
    const lastDay = clean.length ? clean[clean.length - 1].day : 0;
    if (sparse && projected.length) {
      // One or two snapshots draw no shape. The implied path is this video's own score applied
      // to the channel's typical curve — the path that ends where the video actually is — so it
      // runs the whole range with the model's error band, and the real points sit on it as dots.
      for (const p of projected) {
        const a = aleAt(p.day);
        Object.assign(at(p.day), {
          implied: p.projected,
          impliedBand: [p.projected * Math.exp(-a), p.projected * Math.exp(a)] as [number, number],
        });
      }
    } else {
      for (const p of projected) if (p.day >= lastDay) at(p.day).projected = p.projected;
      if (clean.length) at(lastDay).projected = clean[clean.length - 1].views;
      for (const a of clean) at(a.day).views = a.views;
    }
    for (const a of clean) at(a.day).dot = a.views;
    // Every video has zero views at publish: anchor the typical curve there so the axis starts at 0h.
    if (curve.length && !byDay.has(0)) Object.assign(at(0), { expected: 0, band: [0, 0] as [number, number] });
    return [...byDay.values()].sort((a, b) => a.day - b.day);
  }, [actuals, curve, projected, sparse]);

  const launch = zoom === '72h';
  const rows = launch ? all.filter((r) => r.day <= 3) : all;
  const maxDay = launch ? 3 : Math.max(...all.map((r) => r.day), 1);
  const minDay = 0;
  const endBaseline = launch || !curve.length ? null : curve[curve.length - 1];
  const endProjected = launch || !projected.length ? null : projected[projected.length - 1];
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
  // More than a few ticks and their labels start colliding; the ticks stay, the words go.
  const labelClusters = clusters.length <= 3;
  // The implied path only exists when there is a projection to scale; without one a sparse
  // video still gets its own line through whatever points it has.
  const implied = sparse && projected.length > 0;

  if (!actuals.length && !curve.length) {
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
            tickFormatter={(d: number) => (launch || d < 1 ? `${Math.round(d * 24)}h` : `d${Math.round(d)}`)}
            minTickGap={12}
          />
          <YAxis tick={{ fontSize: 11, fill: C.muted }} stroke={C.line} width={52} tickFormatter={fmtViews} />
          <Tooltip
            contentStyle={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 12, color: C.ink }}
            labelStyle={{ color: C.muted }}
            labelFormatter={(d: number) => dayLabel(Number(d))}
            formatter={(v: any, name: string) =>
              Array.isArray(v) ? [`${fmtViews(v[0])} – ${fmtViews(v[1])}`, name] : [fmtViews(Number(v)), name]
            }
          />
          <Legend wrapperStyle={{ fontSize: 11, color: C.muted, width: '100%', maxWidth: '100%' }} />
          {/* Recharts puts every declared series in the legend whether or not it has data, so
              each one is mounted only in the states where it actually draws something. */}
          {curve.length > 0 && (
            <Area dataKey="band" name="typical range" connectNulls stroke="none" fill={C.muted} fillOpacity={0.13} isAnimationActive={false} legendType="none" />
          )}
          {implied && (
            <Area dataKey="impliedBand" name="likely range" connectNulls stroke="none" fill={C.accent} fillOpacity={0.1} isAnimationActive={false} legendType="none" />
          )}
          {curve.length > 0 && (
            <Line dataKey="expected" name="typical for this channel" connectNulls dot={false} stroke={C.muted} strokeWidth={1.5} strokeDasharray="4 3" isAnimationActive={false} />
          )}
          {implied && (
            <Line dataKey="implied" name="implied path" connectNulls dot={false} stroke={C.accent} strokeWidth={1.5} strokeDasharray="6 4" isAnimationActive={false} />
          )}
          {!implied && projected.length > 0 && (
            <Line dataKey="projected" name="expected from here" connectNulls dot={false} stroke={C.accent} strokeWidth={1.25} strokeDasharray="5 4" strokeOpacity={0.6} isAnimationActive={false} />
          )}
          {!implied && (
            <Line dataKey="views" name="this video" connectNulls dot={false} stroke={C.accent} strokeWidth={1.75} isAnimationActive={false} />
          )}
          {/* The real measurements as points — a video with one or two snapshots is otherwise a
              model path with nothing of its own on it. */}
          {implied && (
            <Line
              dataKey="dot" name="measured" connectNulls={false} stroke={C.accent} strokeWidth={0} isAnimationActive={false}
              legendType="circle"
              dot={{ r: 3.5, fill: C.accent, stroke: C.surface, strokeWidth: 1.5 }}
              activeDot={{ r: 4, fill: C.accent }}
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
                label={labelClusters || on
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
