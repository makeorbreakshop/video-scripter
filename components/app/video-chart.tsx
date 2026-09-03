'use client';

// The video's view curve, in the reader's terms: where it is now, where the model thinks it
// lands by day 30, and what a typical video on this channel would have done by then. The data
// is the admin chart's data — lib/admin/video-curve.ts is the only place the curve math lives.
//
// This file also owns the hover link between the chart and the packaging timeline below it:
// both draw the same markers, so hovering either highlights the other.

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Actual, CurvePoint, Marker } from '@/lib/admin/video-curve';
import type { SeriesPoint } from '@/lib/app/chart-series';

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

const ET = 'America/New_York';
function dateAtDay(publishedAt: string | Date | null | undefined, day: number): Date | null {
  if (!publishedAt) return null;
  const t0 = new Date(publishedAt).getTime();
  return Number.isFinite(t0) ? new Date(t0 + day * 86_400_000) : null;
}
export function axisDate(publishedAt: string | Date | null | undefined, day: number, launch: boolean): string {
  const d = dateAtDay(publishedAt, day);
  if (!d) return dayLabel(day);
  return launch
    ? d.toLocaleString('en-US', { timeZone: ET, month: 'short', day: 'numeric', hour: 'numeric' }).replace(',', '')
    : d.toLocaleDateString('en-US', { timeZone: ET, month: 'short', day: 'numeric' });
}
export function tooltipDate(publishedAt: string | Date | null | undefined, day: number): string {
  const d = dateAtDay(publishedAt, day);
  if (!d) return dayLabel(day);
  return d.toLocaleString('en-US', { timeZone: ET, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';
}

export function dayLabel(d: number) {
  return d < 1 ? `${Math.round(d * 24)}h` : `day ${d < 10 ? d.toFixed(d % 1 ? 1 : 0) : Math.round(d)}`;
}

export type Zoom = '72h' | 'full';

// The chart is the heaviest thing on this page and the least urgent: the reader's first
// question is the ratio above it. Loading recharts on the client only, behind a plate of the
// chart's own height, keeps it out of the first bundle without moving anything below it when
// it arrives.
const CHART_HEIGHT = 320;

const VideoChartPlot = dynamic(() => import('./video-chart-plot'), {
  ssr: false,
  loading: () => (
    <div
      aria-hidden
      style={{
        height: CHART_HEIGHT, borderRadius: 'var(--cs-radius)',
        border: '1px solid var(--cs-line)', background: 'var(--cs-surface-2)',
      }}
    />
  ),
});

export function VideoChart(props: {
  publishedAt?: string | Date | null;
  actuals: Actual[];
  curve: CurvePoint[];
  series: SeriesPoint[];
  markers: Marker[];
  thumbUrls: Record<number, string>;
  score: number | null;
  defaultZoom?: Zoom;
}) {
  return (
    <div style={{ minHeight: CHART_HEIGHT }}>
      <VideoChartPlot {...props} />
    </div>
  );
}
