'use client';

// One packaging ROTATION as a row. The same primitive is used by the feed, by a channel's
// Changes tab, and (in clip form) by the video page, so it looks the same everywhere.
//
// The product rules this encodes, none of which are negotiable:
//   - the unit is the experiment, not the version: A → B → A is one row;
//   - no share-of-time, no percentages, no rotation counts — we only registered what the
//     watcher saw, so the row says "detected <time>", never "started";
//   - no variant is ever labelled "live now": during a rotation every variant is live;
//   - a settled rotation puts the image it kept on the right and dims the one it stopped
//     showing; a swap is one picture replacing another and is never styled like a rotation.
// The words themselves come from lib/app/test-row.ts, which is pure and tested.
//
// Anatomy: a byline line — who, what state we saw, when — then the media on the left and the
// title and numbers on the right, top-aligned. The same two columns every other feed card
// uses, so this reads as one more item in the feed instead of a foreign three-column row.
//
// One click rule for the whole feed: A STACK OPENS; A PICTURE NAVIGATES. The deck is the only
// stacked object here, and being a stack is what earns it the exception — everything else,
// including every variant once the row is open, links to the video. macOS Stacks works this
// way: click the stack to expand it, click an item inside it to open that item.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { RowVariant, TestRowModel } from '@/lib/app/test-row';
import { ChannelAvatar } from './avatar';
import { installThumbFallback } from './thumb-runtime';

installThumbFallback();

/** How many cards the deck shows. Any beyond this appear when the row opens. */
const DECK_MAX = 3;

function Shot({ v, className, badge, priority, style }: {
  v: RowVariant; className?: string; badge?: React.ReactNode; priority?: boolean; style?: React.CSSProperties;
}) {
  return (
    <span className={`tr-shot ${className ?? ''}`} style={style}>
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

function Close() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden focusable="false">
      <path d="M3.5 3.5l8 8M11.5 3.5l-8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

export function TestRow({ row, avatarUrl, priority = false }: { row: TestRowModel; avatarUrl?: string | null; priority?: boolean }) {
  const [open, setOpen] = useState(false);
  const inner = useRef<HTMLDivElement | null>(null);
  const deckBtn = useRef<HTMLButtonElement | null>(null);
  const closeBtn = useRef<HTMLButtonElement | null>(null);
  const anim = useRef<HTMLDivElement | null>(null);
  const lastHeight = useRef(0);
  const settled = useRef(false);
  const wasOpen = useRef(false);

  // Height is the information here, so it is the property that animates — but from a measured
  // number to a measured number, never to `auto`, which does not interpolate. Written straight
  // to the element with a forced reflow between the two values: no state round trip and no
  // requestAnimationFrame, so it cannot be starved by a throttled frame clock.
  useLayoutEffect(() => {
    const box = anim.current, el = inner.current;
    if (!box || !el) return;
    const next = el.offsetHeight;
    const from = lastHeight.current;
    lastHeight.current = next;
    if (!settled.current) { settled.current = true; return; }
    if (next === from || prefersReducedMotion()) return;
    box.style.transition = 'none';
    box.style.height = `${from}px`;
    void box.offsetHeight;
    box.style.transition = '';
    box.style.height = `${next}px`;
    const done = (e: TransitionEvent) => {
      if (e.target !== box || e.propertyName !== 'height') return;
      box.style.height = '';
      box.removeEventListener('transitionend', done);
    };
    box.addEventListener('transitionend', done);
    return () => { box.removeEventListener('transitionend', done); box.style.height = ''; box.style.transition = ''; };
  }, [open]);

  // Opening moves focus to the close control; closing hands it back to the deck. The button
  // that opened the row has unmounted by then, so without this focus falls to the body
  // (ARIA APG: a disclosure returns focus to the control that opened it).
  useEffect(() => {
    if (!open) {
      if (wasOpen.current) deckBtn.current?.focus();
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const shown = row.variants.slice(0, DECK_MAX);

  // The byline line, kept in both states: who, what state we saw, and when we saw it.
  const head = (
    <div className="cs-byline tr-head">
      {row.channelId ? (
        <Link className="cs-byline-chan" href={`/app/channels/${row.channelId}`}>
          <ChannelAvatar src={avatarUrl} name={row.channelName} size={36} channelId={row.channelId} />
          {row.channelName && <span className="cs-byline-name">{row.channelName}</span>}
        </Link>
      ) : (
        <span className="cs-byline-chan">
          <ChannelAvatar src={avatarUrl} name={row.channelName} size={36} />
          {row.channelName && <span className="cs-byline-name">{row.channelName}</span>}
        </span>
      )}
      <Pill row={row} />
      <span className="tr-headline">{row.headline}</span>
      <span className="cs-num tr-stamp">{row.stamp}</span>
      {open && (
        <button ref={closeBtn} type="button" className="tr-close" onClick={() => setOpen(false)}
                aria-label="Close the thumbnails"><Close /></button>
      )}
    </div>
  );

  // The same unit every feed card is built from: a thumbnail with the title under it, at one
  // width. A settled rotation or a swap is two of them, before → after. A running rotation is
  // one of them whose thumbnail is the deck, with the numbers beside it; hover deals the
  // second card out into that space, so both images are in view without the row changing
  // shape. Click shows them large.
  const unit = (v: RowVariant, extra: { dim?: boolean; badge?: React.ReactNode; priority?: boolean }) => (
    <Link className="cs-vid" href={`${row.href}?v=${v.version}`} data-dim={extra.dim || undefined}>
      <Shot v={v} className="cs-vid-thumb" priority={extra.priority} badge={extra.badge} />
      <span className="cs-vid-title">{row.title}</span>
    </Link>
  );
  let collapsed: React.ReactNode;
  if (row.status !== 'testing') {
    collapsed = (
      <div className="cs-fcard-row" data-change="">
        {row.before && unit(row.before, { dim: true })}
        <Arrow />
        {row.after && unit(row.after, {
          priority, badge: row.status === 'settled' ? <span className="cs-num tr-kept">KEPT</span> : null,
        })}
      </div>
    );
  } else {
    collapsed = (
      <div className="cs-fcard-row tr-live">
        <div className="cs-vid">
          <button ref={deckBtn} type="button" className="tr-media" aria-expanded={open}
                  aria-label={`${row.headline} — open the thumbnails`} onClick={() => setOpen(true)}>
            <span className="tr-deck" style={{ ['--tr-n' as string]: shown.length } as React.CSSProperties}>
              {shown.map((v, i) => (
                <Shot key={v.label} v={v} className="tr-deck-card" priority={priority && i === 0}
                      style={{ ['--tr-i' as string]: i } as React.CSSProperties} />
              ))}
            </span>
          </button>
          <Link className="cs-vid-title tr-title" href={row.href}>{row.title}</Link>
          <span className="tr-meta">{row.meta}</span>
        </div>
      </div>
    );
  }

  const expanded = (
    <div className="tr-open">
      <div className="tr-variants">
      {row.variants.map((v, i) => (
        <figure key={v.label} className="tr-variant" style={{ ['--tr-i' as string]: i } as React.CSSProperties}>
          {/* Every picture navigates. The version rides along so the video page can open on
              the image the reader clicked rather than on whatever is current. */}
          <Link className="tr-variant-link" href={`${row.href}?v=${v.version}`}>
            <Shot v={v} className="tr-shot-full"
                  badge={<span className="cs-num tr-badge" data-current={v.current}>{v.label}</span>} />
            <span className="tr-variant-title">{row.title}</span>
          </Link>
        </figure>
      ))}
      </div>
      <span className="tr-meta">{row.meta}</span>
    </div>
  );

  return (
    <article className="tr-row" data-status={row.status} data-open={open}>
      <div ref={anim} className="tr-anim">
        <div ref={inner}>
          {head}
          {open ? expanded : collapsed}
        </div>
      </div>
    </article>
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
