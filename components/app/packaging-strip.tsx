'use client';

// The packaging history as a row of YouTube cards: a 256×144 thumbnail with the title under it,
// which is the unit a creator already reads all day, and one mono label line above it saying
// which change this is, when, and what the same-age score did across it.
//
// It replaces the old timeline of 200px clips with an expanding TEST clip. The expansion was
// the problem: a test was one card that grew, so the six images inside it were not comparable
// with the cards either side of them. A test is now one card PER VARIANT, all carrying the
// test's own index — nothing repeats, and the winner is marked exactly once.
//
// The cards, their numbers and their labels come from lib/app/packaging-events.ts, which the
// chips under the chart are drawn from too, so card 3 and chip 3 are the same event. This file
// owns scrolling, the arrows, and the hover/click link to those chips.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PackagingCard } from '@/lib/app/packaging-events';
import { localDateTime, localDayRange } from '@/lib/app/local-time';
import { useMarkerHover } from './video-chart';
import { installThumbFallback } from './thumb-runtime';

installThumbFallback();

const TOKEN: Record<string, string> = {
  accent: 'var(--cs-accent)', good: 'var(--cs-good)', warn: 'var(--cs-warn)', muted: 'var(--cs-muted)',
};

/** The label line. Times are written here, in the browser, so they are the reader's own clock. */
function Label({ card, local }: { card: PackagingCard; local: boolean }) {
  return (
    <span className="cs-num ps-label" style={{ color: TOKEN[card.color] }} suppressHydrationWarning>
      {card.label.map((s, i) => (
        <span key={i}>
          {i > 0 && ' · '}
          {s.kind === 'text' ? s.text
            : s.kind === 'time' ? (local ? localDateTime(s.ms).toUpperCase() : '')
            : (local ? localDayRange(s.from, s.to).toUpperCase() : '')}
        </span>
      ))}
    </span>
  );
}

export function PackagingStrip({ cards }: { cards: PackagingCard[] }) {
  const { hovered, setHovered, opened, setOpened } = useMarkerHover();
  const track = useRef<HTMLDivElement | null>(null);
  const openRef = useRef<HTMLDivElement | null>(null);
  const [local, setLocal] = useState(false);
  const [overflow, setOverflow] = useState(false);

  useEffect(() => setLocal(true), []);

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
  }, [measure]);

  // Clicking a chip under the chart scrolls its card into view — and the reverse, because a
  // card sets the same `hovered` key the chip reads.
  useEffect(() => {
    if (!opened || !openRef.current) return;
    openRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [opened]);

  // Wheel and drag pan the strip. A trackpad's horizontal wheel already works; a mouse only
  // has a vertical one, and over a horizontal strip that is what the reader means.
  const drag = useRef<{ x: number; left: number } | null>(null);

  if (!cards.length) return null;

  const scroll = (dir: -1 | 1) => track.current?.scrollBy({ left: dir * 272 * 2, behavior: 'smooth' });

  return (
    <div className="ps-wrap">
      <div className="ps-head">
        <h2>Packaging</h2>
        <span className="ps-arrows">
          <button type="button" className="cs-icon-btn" aria-label="Scroll back" onClick={() => scroll(-1)}>‹</button>
          <button type="button" className="cs-icon-btn" aria-label="Scroll forward" onClick={() => scroll(1)}
                  data-more={overflow || undefined}>›</button>
        </span>
      </div>

      <div
        className="ps-track"
        ref={track}
        onScroll={measure}
        onWheel={(e) => {
          const el = track.current;
          if (!el || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
          el.scrollLeft += e.deltaY;
        }}
        onPointerDown={(e) => {
          if (e.button !== 0 || !track.current) return;
          drag.current = { x: e.clientX, left: track.current.scrollLeft };
        }}
        onPointerMove={(e) => {
          const g = drag.current;
          if (!g || !track.current) return;
          track.current.scrollLeft = g.left - (e.clientX - g.x);
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerLeave={() => { drag.current = null; }}
      >
        {cards.map((c) => (
          <div
            key={c.key}
            className="ps-card"
            data-kind={c.kind}
            data-hot={c.eventKey === hovered || undefined}
            ref={opened === c.eventKey ? openRef : undefined}
            tabIndex={c.kind === 'start' ? -1 : 0}
            onMouseEnter={() => setHovered(c.eventKey)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(c.eventKey)}
            onBlur={() => setHovered(null)}
            onClick={() => setOpened(c.eventKey)}
          >
            <Label card={c} local={local} />
            <span className="ps-shot" style={{ borderColor: c.kind === 'start' ? 'transparent' : TOKEN[c.color] }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img data-cs-thumb="" src={c.url} alt="" width={512} height={288} loading="lazy"
                   decoding="async" referrerPolicy="no-referrer" />
              {c.winner && <span className="cs-num ps-winner">WINNER</span>}
            </span>
            {/* A title change is the same picture: what changed is the words, so both are here,
                the old one struck through and the new one behind the teal rule. */}
            {c.previousTitle && <span className="ps-title-old">{c.previousTitle}</span>}
            <span className="ps-title" data-rule={c.previousTitle ? true : undefined}
                  style={c.previousTitle ? { borderLeftColor: TOKEN[c.color] } : undefined}>
              {c.title}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
