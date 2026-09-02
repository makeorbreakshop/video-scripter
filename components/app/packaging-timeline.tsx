'use client';

// Packaging changes on a real-time scale.
//
// The chart above uses a log day axis, which is right for growth and wrong for a burst of
// swaps inside one afternoon. So this gets its own scale: a full-range bar from publish to
// now, plus a brushed window that opens on the cluster of changes and can be dragged and
// resized. Hovering an item here highlights the matching marker on the chart, and vice versa.

import { useMemo, useRef, useState } from 'react';
import type { Marker } from '@/lib/admin/video-curve';
import { markerKey, useMarkerHover } from './video-chart';
import { Thumb } from './thumb';

const HOUR = 3_600_000;
const ET = 'America/New_York';

function etTime(t: number | string) {
  return new Date(t).toLocaleString('en-US', { timeZone: ET, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function sincePublish(iso: string, t0: number) {
  const h = (new Date(iso).getTime() - t0) / HOUR;
  if (h < 1) return `${Math.max(0, Math.round(h * 60))}m after publish`;
  if (h < 48) return `${h.toFixed(1)}h after publish`;
  return `${Math.round(h / 24)}d after publish`;
}

/**
 * The window to open on: the span of the changes with a 20% margin either side, and at least
 * an hour wide so a single change is not an infinitely thin window.
 */
export function clusterWindow(times: number[], t0: number, tNow: number): [number, number] {
  if (!times.length) return [t0, tNow];
  const lo = Math.min(...times);
  const hi = Math.max(...times);
  const pad = Math.max((hi - lo) * 0.2, HOUR / 2);
  return [Math.max(t0, lo - pad), Math.min(tNow, hi + pad)];
}

type Drag = { mode: 'start' | 'end' | 'pan'; grabbed: number } | null;

export function PackagingTimeline({
  publishedAt, now, markers, thumbUrls,
}: {
  publishedAt: string;
  now: string;
  markers: Marker[];
  thumbUrls: Record<number, string>;
}) {
  const { hovered, setHovered } = useMarkerHover();
  const t0 = new Date(publishedAt).getTime();
  const tNow = Math.max(new Date(now).getTime(), t0 + HOUR);
  const times = useMemo(() => markers.map((m) => new Date(m.at).getTime()), [markers]);
  const [win, setWin] = useState<[number, number]>(() => clusterWindow(times, t0, tNow));
  const trackRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<Drag>(null);

  if (!markers.length) {
    return <p style={{ color: 'var(--cs-muted)', fontSize: 13, margin: 0 }}>No packaging changes yet — the thumbnail and title are still the originals.</p>;
  }

  const span = tNow - t0;
  const pct = (t: number) => `${(((t - t0) / span) * 100).toFixed(3)}%`;
  const timeAt = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return t0;
    return t0 + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * span;
  };

  const onDown = (mode: 'start' | 'end' | 'pan') => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { mode, grabbed: timeAt(e.clientX) };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const t = timeAt(e.clientX);
    setWin(([a, b]) => {
      if (d.mode === 'start') return [Math.min(t, b - HOUR / 12), b];
      if (d.mode === 'end') return [a, Math.max(t, a + HOUR / 12)];
      const shift = Math.max(t0 - a, Math.min(tNow - b, t - d.grabbed));
      drag.current = { ...d, grabbed: t };
      return [a + shift, b + shift];
    });
  };
  const endDrag = () => { drag.current = null; };

  const [w0, w1] = win;
  const inWindow = markers.filter((_, i) => times[i] >= w0 && times[i] <= w1);
  const wSpan = Math.max(1, w1 - w0);
  const tick = (kind: Marker['kind']) => (kind === 'thumb' ? 'var(--cs-accent)' : 'var(--cs-ink)');

  return (
    <div onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 11, color: 'var(--cs-muted)', marginBottom: 5 }}>
        <span>published {etTime(t0)} ET</span>
        <button type="button" className="cs-chip" onClick={() => setWin(clusterWindow(times, t0, tNow))}>fit to changes</button>
        <span>now</span>
      </div>

      {/* Full range, publish → now. The shaded box is the zoom window; drag it or its edges. */}
      <div
        ref={trackRef}
        style={{
          position: 'relative', height: 36, borderRadius: 8, userSelect: 'none',
          border: '1px solid var(--cs-line)', background: 'var(--cs-surface-2)',
        }}
      >
        <div
          role="slider"
          tabIndex={0}
          aria-label="zoom window"
          aria-valuetext={`${etTime(w0)} to ${etTime(w1)} ET`}
          onPointerDown={onDown('pan')}
          style={{
            position: 'absolute', top: 0, bottom: 0, left: pct(w0),
            width: `${(((w1 - w0) / span) * 100).toFixed(3)}%`,
            background: 'var(--cs-accent-soft)',
            boxShadow: 'inset 0 0 0 1px var(--cs-accent)',
            borderRadius: 6, cursor: 'grab',
          }}
        >
          <span onPointerDown={onDown('start')} style={{ position: 'absolute', left: -3, top: 0, bottom: 0, width: 7, borderRadius: 3, background: 'var(--cs-accent)', cursor: 'ew-resize' }} />
          <span onPointerDown={onDown('end')} style={{ position: 'absolute', right: -3, top: 0, bottom: 0, width: 7, borderRadius: 3, background: 'var(--cs-accent)', cursor: 'ew-resize' }} />
        </div>
        {markers.map((m, i) => {
          const key = markerKey(m);
          const on = hovered === key;
          return (
            <span
              key={key}
              onMouseEnter={() => setHovered(key)}
              onMouseLeave={() => setHovered(null)}
              title={`${m.kind === 'thumb' ? 'Thumbnail' : 'Title'} v${m.version} · ${etTime(times[i])} ET`}
              style={{
                position: 'absolute', top: on ? 2 : 6, bottom: on ? 2 : 6, left: pct(times[i]),
                width: on ? 3 : 2, transform: 'translateX(-50%)', borderRadius: 2,
                background: tick(m.kind), opacity: hovered && !on ? 0.35 : 1,
              }}
            />
          );
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--cs-muted)', marginTop: 5 }}>
        <span className="cs-num">{etTime(w0)} ET</span>
        <span>{inWindow.length} of {markers.length} change{markers.length === 1 ? '' : 's'} in view</span>
        <span className="cs-num">{etTime(w1)} ET</span>
      </div>

      {/* The window, expanded: ticks sit at their true position inside it. */}
      <div style={{ position: 'relative', height: 10, marginTop: 12, borderRadius: 5, border: '1px solid var(--cs-line)', background: 'var(--cs-surface)' }}>
        {inWindow.map((m) => {
          const t = new Date(m.at).getTime();
          const on = hovered === markerKey(m);
          return (
            <span
              key={markerKey(m)}
              style={{
                position: 'absolute', top: 0, bottom: 0, left: `${(((t - w0) / wSpan) * 100).toFixed(3)}%`,
                width: on ? 3 : 2, transform: 'translateX(-50%)', background: tick(m.kind),
                opacity: hovered && !on ? 0.35 : 1,
              }}
            />
          );
        })}
      </div>

      <ol style={{ display: 'flex', gap: 10, overflowX: 'auto', listStyle: 'none', margin: '12px 0 0', padding: '0 0 6px' }}>
        {inWindow.map((m) => {
          const key = markerKey(m);
          const on = hovered === key;
          return (
            <li
              key={key}
              tabIndex={0}
              onMouseEnter={() => setHovered(key)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(key)}
              onBlur={() => setHovered(null)}
              style={{
                width: 232, flex: 'none', borderRadius: 'var(--cs-radius)', padding: 9, outline: 'none',
                border: `1px solid ${on ? 'var(--cs-accent)' : 'var(--cs-line)'}`,
                background: on ? 'var(--cs-surface-2)' : 'var(--cs-surface)',
              }}
            >
              {m.kind === 'thumb' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  {[m.fromVersion, m.version].map((v, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, flex: 1 }}>
                      {i === 1 && <span aria-hidden className="cs-arrow">→</span>}
                      <Thumb src={v != null ? thumbUrls[v] : null} alt={`thumbnail v${v}`} caption={`v${v}`} style={{ width: '100%' }} />
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 11 }}>
                  <div style={{ color: 'var(--cs-muted)', textDecoration: 'line-through' }}>{m.from}</div>
                  <div style={{ marginTop: 2 }}>{m.to}</div>
                </div>
              )}
              <div style={{ marginTop: 7, fontSize: 11, color: 'var(--cs-muted)' }}>
                <span style={{ color: 'var(--cs-ink)', fontWeight: 600 }}>
                  {m.kind === 'thumb' ? 'Thumbnail' : 'Title'} v{m.version}
                </span>
                <br />
                <span className="cs-num">{etTime(m.at)} ET</span> · {sincePublish(m.at, t0)}
              </div>
            </li>
          );
        })}
        {!inWindow.length && (
          <li style={{ fontSize: 13, color: 'var(--cs-muted)' }}>No changes inside the window — drag it, or press “fit to changes”.</li>
        )}
      </ol>
    </div>
  );
}
