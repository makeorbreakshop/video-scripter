'use client';

import { useState } from 'react';
import {
  Area, ComposedChart, Line, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot, Legend,
} from 'recharts';
import type { Actual, CurvePoint, Marker, ProjPoint } from '@/lib/admin/video-curve';

function fmt(v: number) {
  return v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + 'K' : String(Math.round(v));
}
function dayLabel(d: number) {
  return d < 1 ? `${Math.round(d * 24)}h` : `d${d < 10 ? d.toFixed(d % 1 ? 1 : 0) : Math.round(d)}`;
}

export type Zoom = '72h' | '30d';

type Row = { day: number; expected?: number; band?: [number, number]; projected?: number; views?: number };

const HOUR_TICKS = [0, 6, 12, 24, 48, 72];

export function SnapshotChart({
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
  const [hover, setHover] = useState<Marker | null>(null);
  const [zoom, setZoom] = useState<Zoom>(defaultZoom);
  if (!actuals.length && !curve.length) return <div className="text-sm text-muted-foreground">No view data yet.</div>;
  const launch = zoom === '72h';

  const byDay = new Map<number, Row>();
  const at = (d: number) => { let r = byDay.get(d); if (!r) { r = { day: d }; byDay.set(d, r); } return r; };
  for (const c of curve) Object.assign(at(c.day), { expected: c.expected, band: [c.lo, c.hi] as [number, number] });
  for (const p of projected) at(p.day).projected = p.projected;
  for (const a of actuals) at(a.day).views = a.views;
  const all: Row[] = [...byDay.values()].sort((a, b) => a.day - b.day);
  const rows = launch ? all.filter((r) => r.day <= 3) : all;

  const maxDay = launch ? 3 : Math.max(...all.map((r) => r.day), 1);
  const minDay = rows.length ? rows[0].day : 0;
  const endBaseline = launch || !curve.length ? null : curve[curve.length - 1];
  const endProjected = launch || !projected.length ? null : projected[projected.length - 1];
  const shown = markers.filter((m) => !launch || m.day <= 3);
  const ticks = launch
    ? HOUR_TICKS.map((h) => h / 24).filter((t) => t >= minDay - 1e-9)
    : [0, 1, 2, 3, 5, 7, 14, 21, 30, 45, 60, 90].filter((t) => t <= maxDay);

  return (
    <div className="relative">
      <div className="mb-2 inline-flex rounded border border-border text-[11px]">
        {(['72h', '30d'] as Zoom[]).map((z) => (
          <button
            key={z}
            type="button"
            onClick={() => setZoom(z)}
            className={`px-2 py-1 ${zoom === z ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {z === '72h' ? 'First 72h' : '30 days'}
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={rows} margin={{ top: 16, right: 52, left: 8, bottom: 0 }}>
          <XAxis
            dataKey="day" type="number" domain={[launch ? minDay : 0, maxDay]} ticks={ticks} allowDataOverflow
            tick={{ fontSize: 11 }} stroke="currentColor"
            tickFormatter={launch ? (d: number) => `${Math.round(d * 24)}h` : dayLabel}
          />
          <YAxis tick={{ fontSize: 11 }} stroke="currentColor" width={56} tickFormatter={fmt} />
          <Tooltip
            contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', fontSize: 12 }}
            labelFormatter={(d: number) => `day ${Number(d).toFixed(2)}`}
            formatter={(v: any, name: string) =>
              name === 'band' ? [`${fmt(v[0])} – ${fmt(v[1])}`, 'expected range'] : [fmt(Number(v)), name]
            }
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Area
            dataKey="band" name="band" connectNulls stroke="none" fill="hsl(var(--muted-foreground))"
            fillOpacity={0.14} isAnimationActive={false} legendType="none"
          />
          <Line
            dataKey="expected" name="baseline (channel)" connectNulls dot={false}
            stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="4 3" isAnimationActive={false}
          />
          <Line
            dataKey="projected" name="projected (this video)" connectNulls dot={false}
            stroke="hsl(var(--primary))" strokeWidth={1} strokeOpacity={0.55} isAnimationActive={false}
          />
          <Line
            dataKey="views" name="actual" connectNulls dot={launch ? { r: 2 } : false}
            stroke="hsl(var(--primary))" strokeWidth={2} isAnimationActive={false}
          />
          <Scatter dataKey="views" fill="hsl(var(--primary))" shape="circle" legendType="none" isAnimationActive={false} />
          {endBaseline && (
            <ReferenceDot
              x={endBaseline.day} y={endBaseline.expected} r={3}
              fill="hsl(var(--muted-foreground))" stroke="none" isFront
              label={{ value: fmt(endBaseline.expected), fontSize: 11, fill: 'hsl(var(--muted-foreground))', position: 'left', offset: 8 }}
            />
          )}
          {endProjected && (
            <ReferenceDot
              x={endProjected.day} y={endProjected.projected} r={3}
              fill="hsl(var(--primary))" stroke="none" isFront
              label={{ value: fmt(endProjected.projected), fontSize: 11, fill: 'hsl(var(--primary))', position: 'left', offset: 8 }}
            />
          )}
          {endBaseline && endProjected && score != null && (
            <ReferenceLine
              segment={[{ x: endBaseline.day, y: endBaseline.expected }, { x: endProjected.day, y: endProjected.projected }]}
              stroke="hsl(var(--foreground))" strokeWidth={1}
              label={{ value: `${score.toFixed(1)}×`, fontSize: 12, fontWeight: 600, fill: 'hsl(var(--foreground))', position: 'right' }}
            />
          )}
          {shown.map((m, i) => (
            <ReferenceLine
              key={m.kind + m.version}
              x={m.day}
              stroke={m.kind === 'thumb' ? '#f59e0b' : '#38bdf8'}
              strokeDasharray="3 3"
              strokeWidth={hover === m ? 2 : 1}
              label={{
                value: m.kind === 'thumb' ? `t${m.version}` : `T${m.version}`,
                fontSize: 10,
                fill: m.kind === 'thumb' ? '#f59e0b' : '#38bdf8',
                position: 'top',
                // stagger the labels so a burst of packaging changes inside an hour stays readable
                dy: (i % 3) * 12,
                dx: ((i % 3) - 1) * 14,
                onMouseEnter: () => setHover(m),
                onMouseLeave: () => setHover(null),
              } as any}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>

      <div className="mt-2 flex flex-wrap gap-2">
        {shown.map((m) => (
          <button
            key={m.kind + m.version}
            type="button"
            onMouseEnter={() => setHover(m)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(m)}
            onBlur={() => setHover(null)}
            className={`rounded border px-1.5 py-0.5 text-[11px] ${
              hover === m ? 'border-foreground text-foreground' : 'border-border text-muted-foreground'
            }`}
          >
            {m.kind === 'thumb' ? 'thumb' : 'title'} v{m.version} · {dayLabel(m.day)}
          </button>
        ))}
      </div>

      {hover && (
        <div className="mt-2 rounded-lg border border-border bg-popover p-3 text-xs">
          <div className="mb-2 text-muted-foreground">
            {hover.kind === 'thumb' ? 'Thumbnail' : 'Title'} v{hover.fromVersion} → v{hover.version} at {dayLabel(hover.day)}
          </div>
          {hover.kind === 'thumb' ? (
            <div className="flex gap-2">
              {[hover.fromVersion, hover.version].map((v, i) =>
                v != null && thumbUrls[v] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={thumbUrls[v]} alt={`v${v}`} className="aspect-video w-[200px] rounded object-cover" />
                ) : (
                  <div key={i} className="flex aspect-video w-[200px] items-center justify-center rounded border border-dashed border-border text-[11px] text-muted-foreground">
                    v{v} not archived
                  </div>
                )
              )}
            </div>
          ) : (
            <div className="space-y-1">
              <div className="text-muted-foreground line-through">{hover.from}</div>
              <div className="text-foreground">{hover.to}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
