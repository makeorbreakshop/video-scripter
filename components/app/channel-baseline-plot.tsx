'use client';

// Where the channel's normal has been, and when it published.
//
// The value axis carries ONE series: `baseline` in publish order — the channel's typical
// day-30 views as of each upload. Videos are not points in that space. Plotting each video's
// own day-30 estimate against the same axis turned this into a views scatter, and the reading
// people took from it was "how big was that video", which is the video page's question. This
// chart's question is where the bar has been.
//
// So videos live on the TIME axis instead: a tick per publish date in a 14px band just above
// the x axis. Nothing about a tick's height encodes views — height says only which of three
// kinds it is (lib/app/baseline-series.markKind), and the accent is spent on the outliers.
//
// The hover is the video chart's hover: the same <HoverCard> chrome, the same Eastern date
// formatting (lib/app/chart-format), the same theme colours, and the same 120px <Thumb> the
// packaging-marker card shows. What is still this chart's own is the tick strip — a daily
// channel puts two thousand marks on this axis, and one <svg> with a nearest-x hit test is the
// only version of that which does not rebuild two thousand recharts components per hover.
//
// The y axis is LOG. A channel's normal can move by an order of magnitude across a decade, and
// log is chosen here rather than offered as a toggle: the reading is the SHAPE of the line.
// (baselineDomain owns the floor — a log axis cannot draw zero.)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ComposedChart, Line, XAxis, YAxis, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import type { BaselinePoint, MarkKind } from '@/lib/app/baseline-series';
import {
  baselineDomain, timeTicks, tickFormat, timeExtent, markKind, MARK_HEIGHT, BAND_HEIGHT,
  nearestByX, cardLeft, CARD_W, CARD_THUMB,
} from '@/lib/app/baseline-series';
import { useThemeColors, fmtViews, etDate, AXIS_DATE, FULL_DATE, MONTH_YEAR, HoverCard } from './video-chart';
import { Thumb } from './thumb';
import { installThumbFallback } from './thumb-runtime';

// One delegated listener for the card's thumbnail, the way every other client component that
// renders a <Thumb> does it — a version that never reached the archive 404s, and a broken
// image in a hover card reads as a bug.
installThumbFallback();

const axisTick = (t: number, fmt: 'month' | 'day') => etDate(t, fmt === 'month' ? MONTH_YEAR : AXIS_DATE);

const CHART_H = 300;
// recharts' default XAxis height, plus the chart's own bottom margin: what the band has to
// clear to sit inside the plot area rather than on the tick labels.
const X_AXIS_H = 30;
const PLOT_LEFT = 56;   // margin.left + YAxis width
const PLOT_RIGHT = 12;  // margin.right

type Ink = { ink: string; muted: string; line: string; accent: string; surface: string };

const strokeFor = (k: MarkKind, C: Ink) => (k === 'outlier' ? C.accent : C.ink);
const opacityFor = (k: MarkKind) => (k === 'outlier' ? 0.95 : k === 'normal' ? 0.34 : 0.14);

/** Baseline line, video tick, outlier tick — drawn in the chart's own strokes. */
function ChartLegend({ C }: { C: Ink }) {
  const item = (swatch: React.ReactNode, label: string) => (
    <li key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.muted, fontSize: 11 }}>
      <svg width={16} height={12} aria-hidden style={{ flex: '0 0 auto' }}>{swatch}</svg>
      <span>{label}</span>
    </li>
  );
  return (
    <ul style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '4px 16px', margin: 0, padding: 0, listStyle: 'none' }}>
      {item(<line x1={0} y1={6} x2={16} y2={6} stroke={C.accent} strokeWidth={2} />, 'Baseline')}
      {item(<line x1={8} y1={2} x2={8} y2={11} stroke={C.ink} strokeOpacity={0.34} strokeWidth={1.5} />, 'Video')}
      {item(<line x1={8} y1={0} x2={8} y2={12} stroke={C.accent} strokeOpacity={0.95} strokeWidth={1.5} />, 'Outlier')}
    </ul>
  );
}

/**
 * The video band. Its own SVG rather than a ReferenceLine per video: a daily channel brings two
 * thousand of them, and recharts would rebuild that many components on every hover. One
 * pointermove over the strip finds the nearest tick instead, which is also what makes a 1px
 * mark hoverable — the hit target is HIT_PX either side, not the stroke.
 */
function VideoBand({ points, C, onOpen }: {
  points: BaselinePoint[]; C: Ink; onOpen: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const [t0, t1] = useMemo(() => timeExtent(points), [points]);
  const xs = useMemo(
    () => points.map((p) => ((p.t - t0) / (t1 - t0)) * w),
    [points, t0, t1, w]
  );

  const move = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setHover(nearestByX(xs, e.clientX - box.left));
  }, [xs]);

  const hovered = hover != null ? points[hover] : undefined;

  // Faintest first, accent last: on a busy channel the outliers have to survive the crowd.
  const order: MarkKind[] = ['insufficient', 'normal', 'outlier'];
  const kinds = useMemo(() => points.map(markKind), [points]);

  return (
    <div
      ref={ref}
      onPointerMove={move}
      onPointerLeave={() => setHover(null)}
      onClick={() => { if (hovered) onOpen(hovered.videoId); }}
      style={{
        position: 'absolute', left: PLOT_LEFT, right: PLOT_RIGHT, bottom: X_AXIS_H,
        height: BAND_HEIGHT, cursor: hovered ? 'pointer' : 'default', touchAction: 'none',
      }}
    >
      {w > 0 && (
        <svg width={w} height={BAND_HEIGHT} aria-hidden style={{ display: 'block', overflow: 'visible' }}>
          {order.map((kind) => (
            <g key={kind} stroke={strokeFor(kind, C)} strokeOpacity={opacityFor(kind)} strokeWidth={1.5}>
              {points.map((p, i) => kinds[i] === kind ? (
                <line key={p.videoId + i} x1={xs[i]} x2={xs[i]}
                      y1={BAND_HEIGHT - MARK_HEIGHT[kind]} y2={BAND_HEIGHT} />
              ) : null)}
            </g>
          ))}
          {hover != null && (
            <line x1={xs[hover]} x2={xs[hover]} y1={0} y2={BAND_HEIGHT}
                  stroke={C.ink} strokeWidth={1.5} />
          )}
        </svg>
      )}
      {hovered && (
        /* Beside the tick, never on it, and never past either edge — lib/app/baseline-series
           .cardLeft owns both rules. The card sits above the band, so the tick and the guide
           line stay visible under it. */
        <HoverCard
          C={C}
          style={{
            position: 'absolute', bottom: BAND_HEIGHT + 6, pointerEvents: 'none', zIndex: 2,
            left: cardLeft(xs[hover!] ?? 0, w), width: CARD_W,
            boxShadow: '0 6px 20px rgba(0,0,0,0.14)',
          }}
        >
          <Thumb
            src={hovered.thumbUrl}
            fallbackSrc={hovered.thumbFallbackUrl}
            alt=""
            loading="eager"
            style={{ width: CARD_THUMB, marginBottom: 6 }}
          />
          <div style={{ fontWeight: 600, marginBottom: 3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
            {hovered.title}
          </div>
          <div style={{ color: C.muted }}>{etDate(hovered.t, FULL_DATE)}</div>
          <div style={{ color: C.muted }}>
            {hovered.est30 != null ? `${fmtViews(hovered.est30)} at day 30` : 'no day-30 estimate'}
          </div>
          <div style={{ color: markKind(hovered) === 'outlier' ? C.accent : C.muted }}>
            {hovered.score != null ? `${hovered.score.toFixed(1)}×` : 'no score yet'}
          </div>
        </HoverCard>
      )}
    </div>
  );
}

export default function ChannelBaselinePlot({ points }: { points: BaselinePoint[] }) {
  const C = useThemeColors();
  const router = useRouter();

  const domain = useMemo(() => baselineDomain(points), [points]);
  const ticks = useMemo(() => timeTicks(points), [points]);
  const fmt = tickFormat(points);

  return (
    <div style={{ width: '100%', maxWidth: '100%', overflow: 'hidden' }}>
      <div style={{ position: 'relative', width: '100%' }}>
        <ResponsiveContainer width="100%" height={CHART_H}>
          <ComposedChart data={points} margin={{ top: 16, right: PLOT_RIGHT, left: 4, bottom: 0 }}>
            <CartesianGrid stroke={C.line} strokeOpacity={0.6} vertical={false} />
            <XAxis
              dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} ticks={ticks}
              tick={{ fontSize: 11, fill: C.muted }} stroke={C.line} height={X_AXIS_H}
              tickFormatter={(t: number) => axisTick(Number(t), fmt)} minTickGap={16}
            />
            <YAxis
              scale="log" domain={domain} allowDataOverflow
              tick={{ fontSize: 11, fill: C.muted }} stroke={C.line} width={52} tickFormatter={fmtViews}
            />
            <Line
              /* linear, not monotone: the baseline moves when a video publishes, and a spline
                 through those points would invent curvature between two real values. */
              dataKey="baseline" type="linear" connectNulls dot={false} activeDot={false}
              stroke={C.accent} strokeWidth={2} isAnimationActive={false} legendType="none"
            />
          </ComposedChart>
        </ResponsiveContainer>
        <VideoBand points={points} C={C} onOpen={(id) => router.push(`/app/videos/${id}`)} />
      </div>
      {/* Drawn under the plot rather than through recharts' <Legend>, which reserves height for
          its wrapper inside the chart box — on a 375px screen the entries wrap and that
          reservation eats a third of the plot. */}
      <div style={{ marginTop: 6 }}>
        <ChartLegend C={C} />
      </div>
    </div>
  );
}
