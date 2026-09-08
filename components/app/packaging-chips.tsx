'use client';

// The packaging chips: one row of thumbnails under the chart's x axis, at the day each change
// landed on.
//
// Every event is the SAME chip — 48×27, a 2px border in the event's colour — because the size
// of a chip used to encode nothing and read as importance. What it carries instead is a number,
// and that number is the card's number in the strip below: chip 3 IS card 3.
//
// Events too close together to draw side by side collapse into a stack, offset by 8px like a
// deck, with the count on the top card and the index RANGE under it. Hovering or focusing the
// stack opens the app's plate above it, listing the stacked events as full-size chips. Which
// events share a slot is a question about pixels, so it is answered in lib/app/packaging-events
// (chipClusters) and asserted there; this file is the surface.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  chipClusters, clampPopover, stackLabel, EVENT_COLOR,
  CHIP_WIDTH_PX, STACK_OFFSET_PX, type ChipCluster, type PackagingEvent,
} from '@/lib/app/packaging-events';
import { useMarkerHover } from './video-chart';
import { installThumbFallback } from './thumb-runtime';

installThumbFallback();

const TOKEN: Record<string, string> = {
  accent: 'var(--cs-accent)', good: 'var(--cs-good)', warn: 'var(--cs-warn)', muted: 'var(--cs-muted)',
};

function color(e: PackagingEvent): string {
  return TOKEN[EVENT_COLOR[e.kind]] ?? TOKEN.muted;
}

/** One 48×27 picture with the event's ink around it. A title change wears an "Aa". */
function Chip({ e, style }: { e: PackagingEvent; style?: React.CSSProperties }) {
  return (
    <span className="pc-chip" style={{ borderColor: color(e), ...style }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img data-cs-thumb="" src={e.url} alt="" width={192} height={108} loading="lazy" decoding="async"
           referrerPolicy="no-referrer" />
      {e.kind === 'title' && <span className="pc-glyph" style={{ color: TOKEN.good }}>Aa</span>}
    </span>
  );
}

export function PackagingChips({
  events, domain, insetLeft, insetRight,
}: {
  events: PackagingEvent[];
  domain: [number, number];
  insetLeft: number;
  insetRight: number;
}) {
  const { hovered, setHovered, setOpened } = useMarkerHover();
  const track = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const read = () => setWidth(el.getBoundingClientRect().width);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const clusters = useMemo(() => chipClusters(events, domain, width), [events, domain, width]);

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setOpen(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!events.length) return null;

  return (
    <div className="pc-row" style={{ paddingLeft: insetLeft, paddingRight: insetRight }}>
      <div className="pc-track" ref={track}>
        {clusters.map((c) => (
          <Slot key={c.key} c={c} plotWidth={width}
                open={open === c.key} setOpen={setOpen}
                hovered={hovered} setHovered={setHovered} setOpened={setOpened} />
        ))}
      </div>
    </div>
  );
}

function Slot({ c, plotWidth, open, setOpen, hovered, setHovered, setOpened }: {
  c: ChipCluster; plotWidth: number; open: boolean; setOpen: (k: string | null) => void;
  hovered: string | null; setHovered: (k: string | null) => void; setOpened: (k: string | null) => void;
}) {
  const stacked = c.events.length > 1;
  const hot = c.events.some((e) => e.key === hovered);
  const shown = c.events.slice(0, 3);
  const width = stacked ? CHIP_WIDTH_PX + STACK_OFFSET_PX * (shown.length - 1) : CHIP_WIDTH_PX;
  const popWidth = Math.min(c.events.length * (CHIP_WIDTH_PX + 6) + 10, Math.max(plotWidth, CHIP_WIDTH_PX));

  return (
    <div className="pc-slot" style={{ left: c.x, width }} data-hot={hot || undefined}>
      <span className="pc-tick" style={{ background: color(c.events[0]) }} aria-hidden />
      <button
        type="button"
        className="pc-hit"
        style={{ width }}
        aria-label={stacked ? `${stackLabel(c.events)} — changes ${c.label}` : `change ${c.label}`}
        aria-expanded={stacked ? open : undefined}
        onMouseEnter={() => { setHovered(c.events[0].key); if (stacked) setOpen(c.key); }}
        onMouseLeave={() => { setHovered(null); if (stacked) setOpen(null); }}
        onFocus={() => { setHovered(c.events[0].key); if (stacked) setOpen(c.key); }}
        onBlur={() => { setHovered(null); if (stacked) setOpen(null); }}
        onClick={() => setOpened(c.events[0].key)}
      >
        {stacked ? (
          <span className="pc-stack" style={{ width }}>
            {shown.map((e, i) => (
              <Chip key={e.key} e={e} style={{ position: 'absolute', left: i * STACK_OFFSET_PX, top: 0 }} />
            ))}
            <span className="pc-count" style={{ left: (shown.length - 1) * STACK_OFFSET_PX, borderColor: color(c.events[0]) }}>
              {c.events.length}
            </span>
          </span>
        ) : (
          <Chip e={c.events[0]} />
        )}
      </button>
      <span className="cs-num pc-index">{c.label}</span>

      {stacked && open && (
        <div className="cs-plate pc-pop"
             style={{ width: popWidth, left: clampPopover(c.x, popWidth, plotWidth) - c.x }}>
          <span className="cs-num pc-pop-label" style={{ color: color(c.events[0]) }}>
            {stackLabel(c.events)} · {c.label}
          </span>
          <span className="pc-pop-chips">
            {c.events.map((e) => (
              <button key={e.key} type="button" className="pc-pop-chip"
                      onMouseEnter={() => setHovered(e.key)} onMouseLeave={() => setHovered(null)}
                      onClick={() => setOpened(e.key)}>
                <Chip e={e} />
                <span className="cs-num pc-index">{e.index}</span>
              </button>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}
