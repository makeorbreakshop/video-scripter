'use client';

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

type Snap = { day: string; view_count: number; days_since_published: number };
type Marker = { day: string; label: string };

export function SnapshotChart({ snapshots, markers = [] }: { snapshots: Snap[]; markers?: Marker[] }) {
  if (snapshots.length < 2) {
    return <div className="text-sm text-muted-foreground">Only {snapshots.length} snapshot(s) so far.</div>;
  }
  const data = snapshots.map((s) => ({ ...s, views: Number(s.view_count) }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
        <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="currentColor" tickFormatter={(d) => d.slice(5)} />
        <YAxis
          tick={{ fontSize: 11 }}
          stroke="currentColor"
          width={56}
          tickFormatter={(v) => (v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : v)}
        />
        <Tooltip
          contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', fontSize: 12 }}
          formatter={(v: number) => [v.toLocaleString(), 'views']}
          labelFormatter={(d, p) => `${d} · day ${p?.[0]?.payload?.days_since_published ?? '?'}`}
        />
        {markers.map((m) => (
          <ReferenceLine key={m.day + m.label} x={m.day} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: m.label, fontSize: 10, fill: '#f59e0b', position: 'top' }} />
        ))}
        <Line type="monotone" dataKey="views" stroke="hsl(var(--primary))" dot={data.length < 60} strokeWidth={2} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
