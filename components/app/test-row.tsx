'use client';

// One packaging TEST as a row. The same primitive is used by the feed, by a channel's Changes
// tab, and (in clip form) by the video page, so a test looks the same everywhere.
//
// The product rules this encodes, none of which are negotiable:
//   - the unit is the test, not the version: A → B → A is one experiment, one row;
//   - no share-of-time, no percentages, no rotation counts — we only registered what the
//     watcher saw, so the row says "detected <time>", never "started";
//   - no variant is ever labelled "live now": during a test every variant is live;
//   - a settled test puts the winner on the right and dims the image it beat;
//   - a swap is one picture replacing another and is never styled like a test.
// The words themselves come from lib/app/test-row.ts, which is pure and tested.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { RowVariant, TestRowModel } from '@/lib/app/test-row';
import { ChannelAvatar } from './avatar';
import { installThumbFallback } from './thumb-runtime';

installThumbFallback();

function Shot({ v, className, badge, priority }: { v: RowVariant; className?: string; badge?: React.ReactNode; priority?: boolean }) {
  return (
    <span className={`tr-shot ${className ?? ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img data-cs-thumb="" src={v.url} alt="" width={480} height={270}
           loading={priority ? 'eager' : 'lazy'} decoding="async" referrerPolicy="no-referrer" />
      {badge}
    </span>
  );
}

function Pill({ row }: { row: TestRowModel }) {
  return (
    <span className="tr-pill" data-status={row.status}>
      {row.status === 'testing' && <span className="tr-dot" aria-hidden />}
      {row.pill}
    </span>
  );
}

function Arrow() {
  return (
    <svg className="tr-arrow" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden focusable="false">
      <path d="M2 8h11M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

export function TestRow({ row, avatarUrl, priority = false }: { row: TestRowModel; avatarUrl?: string | null; priority?: boolean }) {
  const [open, setOpen] = useState(false);
  const inner = useRef<HTMLDivElement | null>(null);
  const lastHeight = useRef(0);
  const settled = useRef(false);
  // undefined means "auto": the row owns its own height again once the transition has landed.
  const [height, setHeight] = useState<number | undefined>(undefined);

  // Height is the information here, so it is the property that animates — but from a measured
  // number to a measured number, never to `auto`, which does not interpolate.
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const next = el.offsetHeight;
    if (settled.current && next !== lastHeight.current && !prefersReducedMotion()) {
      const from = lastHeight.current;
      setHeight(from);
      requestAnimationFrame(() => requestAnimationFrame(() => setHeight(next)));
    }
    lastHeight.current = next;
    settled.current = true;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const byline = (
    <span className="tr-by">
      <ChannelAvatar src={avatarUrl} name={row.channelName} size={18} channelId={row.channelId} />
      {row.channelName && <span className="tr-chan">{row.channelName}</span>}
    </span>
  );

  const status = (
    <span className="tr-status">
      <span className="tr-status-line">
        <Pill row={row} />
        <span className="tr-headline">{row.headline}</span>
      </span>
      <span className="cs-num tr-stamp">{row.stamp}</span>
    </span>
  );

  // Open, the row already shows the variants, so the header keeps only the state and the time.
  const statusInline = (
    <span className="tr-status-inline">
      <Pill row={row} />
      <span className="cs-num tr-stamp">{row.stamp}</span>
    </span>
  );

  // Collapsed middle. A test is a deck you can open; a swap is a before and an after.
  let middle: React.ReactNode;
  if (row.status === 'swap') {
    middle = (
      <span className="tr-swap">
        {row.before && <Shot v={row.before} className="tr-shot-sm tr-dim" />}
        <Arrow />
        {row.after && <Shot v={row.after} className="tr-shot-lg tr-shot-new" priority={priority} />}
      </span>
    );
  } else if (row.status === 'settled') {
    middle = (
      <span className="tr-settled">
        {row.before && <Shot v={row.before} className="tr-shot-sm tr-dim" />}
        {row.after && (
          <Shot v={row.after} className="tr-shot-lg tr-shot-win" priority={priority}
                badge={<span className="cs-num tr-winner">WINNER</span>} />
        )}
      </span>
    );
  } else {
    middle = (
      <span className="tr-deck">
        {row.variants.slice(0, 3).reverse().map((v, i, a) => (
          <Shot key={v.label} v={v} className={`tr-deck-card tr-deck-${a.length - 1 - i}`} priority={priority && i === a.length - 1} />
        ))}
      </span>
    );
  }

  const collapsed = (
    <div className="tr-collapsed">
      <div className="tr-left">
        {byline}
        <Link className="tr-title" href={row.href}>{row.title}</Link>
        <span className="tr-meta">{row.meta}</span>
      </div>
      {row.expandable ? (
        <button type="button" className="tr-open" aria-expanded={open}
                aria-label={`${row.headline} — show the thumbnails`} onClick={() => setOpen(true)}>
          {middle}
        </button>
      ) : (
        <span className="tr-open" aria-hidden={false}>{middle}</span>
      )}
      {status}
    </div>
  );

  const expanded = (
    <div className="tr-expanded">
      <button type="button" className="tr-head" aria-expanded onClick={() => setOpen(false)}>
        <span className="tr-head-left">
          {byline}
          <span className="tr-meta">{row.meta}</span>
        </span>
        <span className="tr-head-right">{statusInline}</span>
      </button>
      <div className="tr-variants">
        {row.variants.map((v, i) => (
          <figure key={v.label} className="tr-variant" style={{ ['--tr-i' as any]: i }}>
            <Shot v={v} className="tr-shot-full"
                  badge={<span className="cs-num tr-badge" data-current={v.current}>{v.label}</span>} />
            {/* Thumbnails and the title under each, YouTube-card style. Nothing else: the
                channel and the numbers are already in the row header above. */}
            <figcaption className="tr-variant-title">{row.title}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );

  return (
    <div className="tr-row" data-status={row.status} data-open={open}>
      <div className="tr-anim" style={height === undefined ? undefined : { height }}
           onTransitionEnd={(e) => { if (e.propertyName === 'height') setHeight(undefined); }}>
        <div ref={inner}>{open ? expanded : collapsed}</div>
      </div>
    </div>
  );
}

export function TestRowList({ rows, avatars = {}, empty }: {
  rows: TestRowModel[]; avatars?: Record<string, string>; empty?: React.ReactNode;
}) {
  if (!rows.length) return <>{empty ?? null}</>;
  return (
    <div className="tr-list">
      {rows.map((r, i) => (
        <TestRow key={`${r.videoId}-${r.at}`} row={r} avatarUrl={r.channelId ? avatars[r.channelId] : null} priority={i < 2} />
      ))}
    </div>
  );
}
