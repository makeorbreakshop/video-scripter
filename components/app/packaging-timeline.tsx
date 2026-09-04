'use client';

// The video's packaging history as a horizontal timeline: a date ruler, then equal-width clips
// left to right — what it was published as, the test, each title change, and what it is wearing
// now. Replaces the old strip of every thumbnail version, which drew an A/B/A rotation as three
// separate images and made one experiment look like three decisions.
//
// The clips come from lib/app/packaging-timeline.ts (pure, tested). This file is the surface:
// scrolling, the inline expansion of a TEST clip, and the hover link to the chart above — both
// draw the same markers, so hovering either highlights the other.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TimelineClip } from '@/lib/app/packaging-timeline';
import { nowLabel } from '@/lib/app/packaging-timeline';
import { useMarkerHover } from './video-chart';
import { installThumbFallback } from './thumb-runtime';

installThumbFallback();

function Shot({ src, fallback, badge, className }: { src: string; fallback?: string | null; badge?: React.ReactNode; className?: string }) {
  return (
    <span className={`pt-shot ${className ?? ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img data-cs-thumb="" data-cs-fallback={fallback || undefined} src={src} alt=""
           width={480} height={270} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
      {badge}
    </span>
  );
}

function Chevron({ className, dir = 'down' }: { className?: string; dir?: 'down' | 'right' }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden focusable="false">
      <path d={dir === 'down' ? 'M3 4.5l3 3 3-3' : 'M4.5 3l3 3-3 3'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PackagingTimeline({ clips, ticks }: { clips: TimelineClip[]; ticks: string[] }) {
  // Which clip is open is shared state, not local: a click on that test's window in the chart
  // above opens it here and scrolls it into view. Hover only highlights — when hover also
  // expanded, moving the mouse across the strip opened and closed the thing under the cursor.
  const { hovered, setHovered, opened, setOpened } = useMarkerHover();
  const [overflow, setOverflow] = useState(false);
  const track = useRef<HTMLDivElement | null>(null);
  const openRef = useRef<HTMLButtonElement | null>(null);

  const measure = useCallback(() => {
    const el = track.current;
    if (el) setOverflow(el.scrollWidth - el.clientWidth > 8);
  }, []);

  useEffect(() => {
    measure();
    const el = track.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, opened]);

  useEffect(() => {
    if (!opened) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpened(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [opened, setOpened]);

  // Opened from the chart: bring the entry the reader clicked into view.
  useEffect(() => {
    if (!opened || !openRef.current) return;
    openRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [opened]);

  const hot = (keys?: string[]) => !!(hovered && keys && keys.includes(hovered));
  const link = (keys?: string[]) => ({
    onMouseEnter: () => setHovered(keys?.[0] ?? null),
    onMouseLeave: () => setHovered(null),
    onFocus: () => setHovered(keys?.[0] ?? null),
    onBlur: () => setHovered(null),
  });

  if (!clips.length) return null;

  return (
    <div className="pt-wrap">
      <div className="pt-ruler cs-num" aria-hidden>
        {ticks.map((t, i) => <span key={`${t}-${i}`}>{t}</span>)}
      </div>

      <div className="pt-track" ref={track} onScroll={measure}>
        {clips.map((c) => {
          if (c.kind === 'test') {
            const back = c.variants[0];
            const front = c.variants[c.variants.length - 1];
            const open = opened === c.key;
            return (
              <button key={c.key} type="button" className="pt-clip" data-kind="test" data-open={open}
                      ref={open ? openRef : undefined}
                      data-hot={hot(c.markerKeys)} aria-expanded={open}
                      onClick={() => setOpened(open ? null : c.key)} {...link(c.markerKeys)}>
                {open ? (
                  <>
                    <span className="pt-testline">
                      <span className="tr-pill" data-status="settled">TEST</span>
                      <span>{c.headline}</span>
                      <span className="cs-num pt-label">· {c.range}</span>
                      <Chevron className="pt-chev" />
                    </span>
                    <span className="pt-vars">
                      {c.variants.map((v, i) => (
                        <span key={v.label} className="pt-var" style={{ ['--tr-i' as any]: i }}>
                          <Shot src={v.url}
                                badge={<span className="cs-num pt-badge" data-current={v.current}>{v.label}</span>} />
                          <span className="pt-title">{c.title}</span>
                        </span>
                      ))}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="pt-deck">
                      {back && <Shot src={back.url} />}
                      {front && <Shot src={front.url} />}
                    </span>
                    <span className="pt-testline">
                      <span className="tr-pill" data-status="settled">TEST</span>
                      <span>{c.headline}</span>
                      <Chevron className="pt-chev" />
                    </span>
                    <span className="cs-num pt-label">{c.range}</span>
                  </>
                )}
              </button>
            );
          }
          const keys = c.kind === 'title' || c.kind === 'swap' ? c.markerKeys : undefined;
          return (
            <div key={c.key} className="pt-clip" data-kind={c.kind} data-hot={hot(keys)} tabIndex={keys ? 0 : -1} {...link(keys)}>
              <Shot src={c.url} />
              <span className="pt-title">{c.title}</span>
              <span className="cs-num pt-label" data-now={c.kind === 'now'}>
                {c.kind === 'now' ? nowLabel(c.score) : c.label}
              </span>
            </div>
          );
        })}
      </div>

      {overflow && (
        <>
          <span className="pt-fade" aria-hidden />
          <button type="button" className="pt-next" aria-label="Scroll the timeline forward"
                  onClick={() => track.current?.scrollBy({ left: 220, behavior: 'smooth' })}>
            <Chevron dir="right" />
          </button>
        </>
      )}
    </div>
  );
}
