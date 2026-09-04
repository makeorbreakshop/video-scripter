'use client';

// Where the channel's normal has been, and every video against it.
//
// One line and one cloud of dots on ONE axis. The line is `baseline` in publish order — the
// channel's typical day-30 views as of each upload — and each dot is that upload's own day-30
// estimate at the same x, so an outlier is a dot sitting above the line and nothing has to be
// coloured to say so.
//
// The y axis is LOG. A channel's day-30 numbers run over three or four orders of magnitude,
// and on a linear axis one 5M video presses the baseline flat against the bottom rule — the
// exact thing this chart exists to show. Log is chosen here, not offered as a toggle: there is
// one reading of this chart and it is the ratio between the dots and the line, which is a
// distance on a log axis. (lib/app/channel-analytics.viewsDomain owns the floor: a log axis
// cannot draw zero, so the series are filtered to positive values and the floor clamped to 1.)

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  ComposedChart, Line, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import type { BaselinePoint } from '@/lib/app/baseline-series';
import { viewsDomain, timeTicks, tickFormat, dotSize } from '@/lib/app/baseline-series';
import { useThemeColors, fmtViews } from './video-chart';

const ET = 'America/New_York';
const axisTick = (t: number, fmt: 'month' | 'day') =>
  new Date(t).toLocaleDateString('en-US', fmt === 'month'
    ? { timeZone: ET, month: 'short', year: '2-digit' }
    : { timeZone: ET, month: 'short', day: 'numeric' });
const fullDay = (t: number) =>
  new Date(t).toLocaleDateString('en-US', { timeZone: ET, month: 'short', day: 'numeric', year: 'numeric' });

/** Line = baseline, dot = video. Two marks, two words, drawn in the chart's own strokes. */
function ChartLegend({ accent, ink, muted }: { accent: string; ink: string; muted: string }) {
  return (
    <ul style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '4px 16px', margin: 0, padding: 0, listStyle: 'none' }}>
      <li style={{ display: 'flex', alignItems: 'center', gap: 6, color: muted, fontSize: 11 }}>
        <svg width={24} height={12} aria-hidden style={{ flex: '0 0 auto' }}>
          <line x1={0} y1={6} x2={24} y2={6} stroke={accent} strokeWidth={2} />
        </svg>
        <span>channel baseline at day 30</span>
      </li>
      <li style={{ display: 'flex', alignItems: 'center', gap: 6, color: muted, fontSize: 11 }}>
        <svg width={24} height={12} aria-hidden style={{ flex: '0 0 auto' }}>
          <circle cx={12} cy={6} r={4} fill={ink} fillOpacity={0.55} />
        </svg>
        <span>video at day 30</span>
      </li>
    </ul>
  );
}

export default function ChannelBaselinePlot({ points }: { points: BaselinePoint[] }) {
  const C = useThemeColors();
  const router = useRouter();

  const domain = useMemo(() => viewsDomain(points), [points]);
  const ticks = useMemo(() => timeTicks(points), [points]);
  const fmt = tickFormat(points);
  const size = dotSize(points.length);

  // ONE colour for every dot. Colouring the 2× ones accent was double-encoding: a dot's
  // distance above the line already IS its score, and painting that distance a second time
  // would spend the only free channel on information the chart has already given. A video the
  // model would not stand behind is the same subject drawn fainter, not a second series.
  const dot = (props: any) => {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null) return <g />;
    return (
      <circle
        cx={cx} cy={cy} r={size.r}
        fill={C.ink} fillOpacity={payload?.weak ? 0.18 : 0.55}
        stroke={C.surface} strokeWidth={payload?.weak ? 0 : size.ring}
      />
    );
  };

  const onClick = (e: any) => {
    const id = e?.activePayload?.[0]?.payload?.videoId;
    if (id) router.push(`/app/videos/${id}`);
  };

  return (
    <div style={{ width: '100%', maxWidth: '100%', overflow: 'hidden' }}>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={points} margin={{ top: 16, right: 12, left: 4, bottom: 0 }} onClick={onClick}>
          <CartesianGrid stroke={C.line} strokeOpacity={0.6} vertical={false} />
          <XAxis
            dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} ticks={ticks}
            tick={{ fontSize: 11, fill: C.muted }} stroke={C.line}
            tickFormatter={(t: number) => axisTick(Number(t), fmt)} minTickGap={16}
          />
          <YAxis
            scale="log" domain={domain} allowDataOverflow
            tick={{ fontSize: 11, fill: C.muted }} stroke={C.line} width={52} tickFormatter={fmtViews}
          />
          <Tooltip
            cursor={{ stroke: C.line, strokeWidth: 1 }}
            content={({ active, payload }: any) => {
              const p: BaselinePoint | undefined = active ? payload?.[0]?.payload : undefined;
              if (!p) return null;
              return (
                <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 8, padding: '8px 10px', fontSize: 12, color: C.ink, maxWidth: 260 }}>
                  <div style={{ fontWeight: 600, marginBottom: 3 }}>{p.title}</div>
                  <div style={{ color: C.muted }}>{fullDay(p.t)}</div>
                  <div style={{ color: C.muted }}>
                    {p.est30 != null ? `${fmtViews(p.est30)} at day 30` : 'no day-30 estimate'}
                    {p.score != null ? ` · ${p.score.toFixed(1)}×` : ''}
                  </div>
                </div>
              );
            }}
          />
          <Scatter dataKey="est30" shape={dot} isAnimationActive={false} legendType="none" />
          <Line
            /* linear, not monotone: the baseline moves when a video publishes, and a spline
               through those points would invent curvature between two real values. */
            dataKey="baseline" type="linear" connectNulls dot={false} activeDot={false}
            stroke={C.accent} strokeWidth={2} isAnimationActive={false} legendType="none"
          />
        </ComposedChart>
      </ResponsiveContainer>
      {/* Drawn under the plot rather than through recharts' <Legend>, which reserves height
          for its wrapper inside the chart box — on a 375px screen the two entries wrap and
          that reservation eats a third of the plot. */}
      <div style={{ marginTop: 6 }}>
        <ChartLegend accent={C.accent} ink={C.ink} muted={C.muted} />
      </div>
    </div>
  );
}
