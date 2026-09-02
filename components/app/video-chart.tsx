'use client';

// The video's view curve, in the reader's terms: where it is now, where the model thinks it
// lands by day 30, and what a typical video on this channel would have done by then. The data
// is the admin chart's data — lib/admin/video-curve.ts is the only place the curve math lives.
//
// This file also owns the hover link between the chart and the packaging timeline below it:
// both draw the same markers, so hovering either highlights the other.

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  Area, ComposedChart, Line, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot, Legend,
} from 'recharts';
import type { Actual, CurvePoint, Marker, ProjPoint } from '@/lib/admin/video-curve';
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

export type Zoom = '72h' | '30d';
type Row = { day: number; expected?: number; band?: [number, number]; projected?: number; views?: number };

const HOUR_TICKS = [0, 6, 12, 24, 48, 72];
const DAY_TICKS = [0, 1, 2, 3, 5, 7, 14, 21, 30, 45, 60, 90];

export function VideoChart({
  actuals, curve, projected, markers, thumbUrls, score, defaultZoom = '30d',
}: {
  actuals: Actual[];
  curve: CurvePoint[];
  projected: ProjPoint[];
  markers: Marker[];
  thumbUrls: Record<number, string>;
  score: number | null;
  defaultZoom?: Zoom;
}) {
  const { hovered, setHovered } = useMarkerHover();
  const [zoom, setZoom] = useState<Zoom>(defaultZoom);
  const C = useThemeColors();

  const all = useMemo(() => {
    const byDay = new Map<number, Row>();
    const at = (d: number) => { let r = byDay.get(d); if (!r) { r = { day: d }; byDay.set(d, r); } return r; };
    for (const c of curve) Object.assign(at(c.day), { expected: c.expected, band: [c.lo, c.hi] as [number, number] });
    for (const p of projected) at(p.day).projected = p.projected;
    for (const a of actuals) at(a.day).views = a.views;
    return [...byDay.values()].sort((a, b) => a.day - b.day);
  }, [actuals, curve, projected]);

  if (!actuals.length && !curve.length) {
    return <p style={{ color: 'var(--cs-muted)', fontSize: 13 }}>No view data yet — the first snapshot lands within a day of publish.</p>;
  }

  const launch = zoom === '72h';
  const rows = launch ? all.filter((r) => r.day <= 3) : all;
  const maxDay = launch ? 3 : Math.max(...all.map((r) => r.day), 1);
  const minDay = rows.length ? rows[0].day : 0;
  const endBaseline = launch || !curve.length ? null : curve[curve.length - 1];
  const endProjected = launch || !projected.length ? null : projected[projected.length - 1];
  const shown = markers.filter((m) => !launch || m.day <= 3);
  const ticks = launch
    ? HOUR_TICKS.map((h) => h / 24).filter((t) => t >= minDay - 1e-9)
    : DAY_TICKS.filter((t) => t <= maxDay);
  const hoveredMarker = markers.find((m) => markerKey(m) === hovered) ?? null;

  return (
    <div>
      <div className="cs-chips" style={{ marginBottom: 10 }}>
        {(['72h', '30d'] as Zoom[]).map((z) => (
          <button key={z} type="button" className="cs-chip" data-on={zoom === z} aria-pressed={zoom === z} onClick={() => setZoom(z)}>
            {z === '72h' ? 'First 72h' : '30 days'}
          </button>
        ))}
      </div>

      {/* Recharts sizes its legend wrapper from the legend's own content, which on a narrow
          screen is wider than the chart and would stretch the whole page. Clip it here. */}
      <div style={{ width: '100%', maxWidth: '100%', overflow: 'hidden' }}>
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={rows} margin={{ top: 20, right: 58, left: 4, bottom: 0 }}>
          <XAxis
            dataKey="day" type="number" domain={[launch ? minDay : 0, maxDay]} ticks={ticks} allowDataOverflow
            tick={{ fontSize: 11, fill: C.muted }} stroke={C.line}
            tickFormatter={(d: number) => (launch || d < 1 ? `${Math.round(d * 24)}h` : `d${Math.round(d)}`)}
          />
          <YAxis tick={{ fontSize: 11, fill: C.muted }} stroke={C.line} width={52} tickFormatter={fmtViews} />
          <Tooltip
            contentStyle={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 12, color: C.ink }}
            labelStyle={{ color: C.muted }}
            labelFormatter={(d: number) => dayLabel(Number(d))}
            formatter={(v: any, name: string) =>
              name === 'band' ? [`${fmtViews(v[0])} – ${fmtViews(v[1])}`, 'expected range'] : [fmtViews(Number(v)), name]
            }
          />
          <Legend wrapperStyle={{ fontSize: 11, color: C.muted, width: '100%', maxWidth: '100%' }} />
          <Area dataKey="band" name="band" connectNulls stroke="none" fill={C.muted} fillOpacity={0.13} isAnimationActive={false} legendType="none" />
          <Line dataKey="expected" name="typical for this channel" connectNulls dot={false} stroke={C.muted} strokeWidth={1.5} strokeDasharray="4 3" isAnimationActive={false} />
          <Line dataKey="projected" name="projected" connectNulls dot={false} stroke={C.accent} strokeWidth={1} strokeOpacity={0.5} isAnimationActive={false} />
          <Line dataKey="views" name="actual views" connectNulls dot={launch ? { r: 2 } : false} stroke={C.accent} strokeWidth={2} isAnimationActive={false} />
          <Scatter dataKey="views" fill={C.accent} shape="circle" legendType="none" isAnimationActive={false} />

          {endBaseline && (
            <ReferenceDot
              x={endBaseline.day} y={endBaseline.expected} r={3} fill={C.muted} stroke="none" isFront
              label={{ value: fmtViews(endBaseline.expected), fontSize: 11, fill: C.muted, position: 'left', offset: 8 }}
            />
          )}
          {endProjected && (
            <ReferenceDot
              x={endProjected.day} y={endProjected.projected} r={3} fill={C.accent} stroke="none" isFront
              label={{ value: fmtViews(endProjected.projected), fontSize: 11, fill: C.accent, position: 'left', offset: 8 }}
            />
          )}
          {endBaseline && endProjected && score != null && (
            <ReferenceLine
              segment={[{ x: endBaseline.day, y: endBaseline.expected }, { x: endProjected.day, y: endProjected.projected }]}
              stroke={C.ink} strokeWidth={1}
              label={{ value: `${score.toFixed(1)}×`, fontSize: 12, fontWeight: 700, fill: C.ink, position: 'right' }}
            />
          )}

          {shown.map((m, i) => {
            const key = markerKey(m);
            const on = hovered === key;
            const color = m.kind === 'thumb' ? C.accent : C.ink;
            return (
              <ReferenceLine
                key={key}
                x={m.day}
                stroke={color}
                strokeDasharray="3 3"
                strokeWidth={on ? 2.5 : 1}
                strokeOpacity={hovered && !on ? 0.3 : 1}
                label={{
                  value: m.kind === 'thumb' ? `t${m.version}` : `T${m.version}`,
                  fontSize: 10,
                  fontWeight: on ? 700 : 400,
                  fill: color,
                  position: 'top',
                  // stagger, so a burst of changes inside one hour stays readable
                  dy: (i % 3) * 12,
                  dx: ((i % 3) - 1) * 14,
                  onMouseEnter: () => setHovered(key),
                  onMouseLeave: () => setHovered(null),
                } as any}
              />
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
      </div>

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
