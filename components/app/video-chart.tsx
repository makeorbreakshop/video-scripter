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
import type { PackagingMark } from '@/lib/app/packaging-groups';
import type { SeriesPoint } from '@/lib/app/chart-series';
import type { ThemeMode } from '@/lib/app/chart-style';

// The number and date formatting both charts share now lives under lib/app so it can be
// asserted; re-exported here because the chart components already import it from this file.
export { fmtViews, dayLabel, axisDate, tooltipDate, etDate, ET, AXIS_DATE, FULL_DATE, MONTH_YEAR } from '@/lib/app/chart-format';

export function markerKey(m: { kind: string; version: number }) {
  return `${m.kind}-${m.version}`;
}

type HoverCtx = {
  hovered: string | null;
  setHovered: (k: string | null) => void;
  /** The packaging group the strip has OPEN. Set by a click, never by a hover. */
  opened: string | null;
  setOpened: (k: string | null) => void;
};
const MarkerHover = createContext<HoverCtx>({ hovered: null, setHovered: () => {}, opened: null, setOpened: () => {} });

/**
 * Wrap the chart, the timeline and the experiment cards in this so hovering one highlights the
 * rest — and so a click on a test window in the chart can open that test's entry in the strip.
 * Hover highlights; only a click opens. The two used to fight: the strip expanded on hover, so
 * moving the mouse across the chart opened and closed the thing the reader was aiming at.
 */
export function MarkerHoverProvider({ children }: { children: React.ReactNode }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const value = useMemo(() => ({ hovered, setHovered, opened, setOpened }), [hovered, opened]);
  return <MarkerHover.Provider value={value}>{children}</MarkerHover.Provider>;
}

export function useMarkerHover() {
  return useContext(MarkerHover);
}

// Recharts writes colours into SVG attributes, where var() is unreliable, so read the theme's
// tokens once and again whenever the theme flips (the header toggle sets data-cs-theme).
// Only used for the first paint before the effect reads the real tokens; theme.css is the source of truth.
const FALLBACK = { ink: '#10131A', muted: '#5A6373', line: '#DDE2EA', accent: '#0E7A3C', surface: '#FFFFFF', mode: 'light' as ThemeMode };

/**
 * Which ground the chart is painted on, resolved the way theme.css resolves it: an explicit
 * [data-cs-theme] wins, and "system" (no attribute) falls through to prefers-color-scheme.
 * The ribbons need it — the same alpha is a clear band on white and a smudge on the dark plate.
 */
export function resolveThemeMode(attr: string | null, prefersDark: boolean): ThemeMode {
  if (attr === 'dark' || attr === 'light') return attr;
  return prefersDark ? 'dark' : 'light';
}

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
        mode: resolveThemeMode(
          document.documentElement.getAttribute('data-cs-theme'),
          window.matchMedia('(prefers-color-scheme: dark)').matches
        ),
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

/**
 * The card every chart hover is drawn on: the plate, the border, the radius, the type size.
 * The video chart's recharts tooltip and the channel baseline chart's thumbnail card are the
 * same object to a reader, so they are one component here — `style` carries only the things
 * that genuinely differ (where a floating card sits, how wide it is, its shadow).
 */
export function HoverCard({ C, style, children }: {
  C: { surface: string; line: string; ink: string };
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.line}`, borderRadius: 8,
      padding: '8px 10px', fontSize: 12, color: C.ink, ...style,
    }}>
      {children}
    </div>
  );
}

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
  marks: PackagingMark[];
  thumbUrls: Record<number, string>;
  score: number | null;
}) {
  return (
    <div style={{ minHeight: CHART_HEIGHT }}>
      <VideoChartPlot {...props} />
    </div>
  );
}
