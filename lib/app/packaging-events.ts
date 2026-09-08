// The packaging history as NUMBERED EVENTS — the one list the chips under the chart and the
// cards in the strip are both drawn from, so chip 3 and card 3 are the same thing to a reader.
//
// The grouping upstream is lib/app/packaging-groups.ts (one TEST is one group, however many
// state rows it wrote). This module does three further things and nothing else:
//
//   1. numbers the groups — 1, 2, 3 … in time order; publish is 0 and carries no chip;
//   2. turns each group into its CARD or CARDS. A test is one card per variant, all sharing
//      the group's index, so the strip never repeats an index and never repeats an event;
//   3. says what the label above a card reads, as segments, because two of them contain a time
//      and times on this page are written in the READER's zone, in the browser.
//
// The before → after ratio is not a new measurement. It is the same-age score — this video's
// views divided by what the channel's typical video had at that same age — read at the last
// count before the event and the first count after it. Same-age is the point: a raw view
// count is larger after any event simply because time passed.
//
// Pure. Everything here is asserted in lib/app/packaging-events.test.ts.
import type { PackagingGroup } from './packaging-groups';
import type { SeriesPoint } from './chart-series';
import type { TypicalPoint } from '../admin/video-curve';

/** What a reader would call the event. `start` is publish, which is a card but not a chip. */
export type PackagingEventKind = 'start' | 'thumbnail' | 'title' | 'test';

/** The ink an event is drawn in — resolved to a token by the components. */
export type EventColor = 'accent' | 'good' | 'warn' | 'muted';

export const EVENT_COLOR: Record<PackagingEventKind, EventColor> = {
  start: 'muted',
  thumbnail: 'accent',
  title: 'good',
  test: 'warn',
};

/** One numbered thing that happened to this video's packaging. One chip, one or more cards. */
export interface PackagingEvent {
  /** Stable identity, shared by the chip and by every card the event produced. */
  key: string;
  index: number;
  kind: PackagingEventKind;
  /** ISO instant the event happened. */
  at: string;
  /** Days since the chart's origin — where the chip sits on the plot's axis. */
  day: number;
  /** The image the chip shows. */
  url: string;
  /** Every packagingMarks() marker key behind it, so a hover still lights the old layers. */
  markerKeys: string[];
}

/** A label above a card. Segments, not a string: two of them carry a time. */
export type LabelSegment =
  | { kind: 'text'; text: string }
  | { kind: 'time'; ms: number }
  | { kind: 'range'; from: number; to: number };

/** One card in the strip. A test contributes one per variant, all with the same `index`. */
export interface PackagingCard {
  key: string;
  /** The event this card belongs to — the chip with the same key highlights with it. */
  eventKey: string;
  index: number;
  kind: PackagingEventKind;
  color: EventColor;
  label: LabelSegment[];
  url: string;
  /** The title the video wore at this card. */
  title: string;
  /** Only a title card has one: the title this card replaced, drawn struck through. */
  previousTitle: string | null;
  /** The variant the rotation kept. Marked once, on that card alone. */
  winner: boolean;
}

// ------------------------------------------------------------------ formatting ----

/** "+1d 5h", "+5h 12m", "+12m" — how long after publish, with no zone in it. */
export function ageOffset(fromMs: number, toMs: number): string {
  const ms = toMs - fromMs;
  if (!Number.isFinite(ms) || ms < 0) return '+0m';
  const mins = Math.floor(ms / 60_000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  if (days > 0) return `+${days}d ${hours}h`;
  if (hours > 0) return `+${hours}h ${mins % 60}m`;
  return `+${mins}m`;
}

/** "1.4× → 2.0×", or null when either end is missing. One decimal under ten, as elsewhere. */
export function liftLabel(before: number | null, after: number | null): string | null {
  if (before == null || after == null || !Number.isFinite(before) || !Number.isFinite(after)) return null;
  const x = (n: number) => `${n.toFixed(n < 10 ? 1 : 0)}×`;
  return `${x(before)} → ${x(after)}`;
}

// -------------------------------------------------------------- the ratio pair ----

/**
 * The same-age score just before and just after an instant.
 *
 * `before` is the last count we actually took at or before the event, `after` the first one at
 * or after it, each divided by the channel's typical value at that same age. When both land on
 * the same reading there is no before and after to show, so `after` is null rather than a
 * repeat of `before`.
 */
export function ratioAround(
  series: readonly SeriesPoint[],
  curve: readonly TypicalPoint[],
  day: number
): { before: number | null; after: number | null } {
  if (!Number.isFinite(day)) return { before: null, after: null };
  const expected = new Map<number, number>();
  for (const c of curve) if (c.expected != null && c.expected > 0) expected.set(c.day, c.expected);
  const scored = series
    .filter((p) => p.kind === 'measured' && p.views > 0 && expected.has(p.day))
    .map((p) => ({ day: p.day, score: p.views / (expected.get(p.day) as number) }))
    .sort((a, b) => a.day - b.day);
  if (!scored.length) return { before: null, after: null };

  let before: { day: number; score: number } | null = null;
  for (const p of scored) { if (p.day <= day) before = p; else break; }
  const after = scored.find((p) => p.day > day) ?? null;
  return { before: before?.score ?? null, after: after?.score ?? null };
}

// ------------------------------------------------------------------ the events ----

export interface BuildPackagingInput {
  /** The chart's origin — publish, or the stream start. Days are measured from here. */
  originAt: string;
  /** When the video went out, for card 0's stamp. */
  publishedAt: string;
  /** The video's current title, worn until the first title change. */
  title: string;
  /** The image the video was published with. */
  publishedUrl: string;
  groups: readonly PackagingGroup[];
  series?: readonly SeriesPoint[];
  curve?: readonly TypicalPoint[];
}

/**
 * The whole strip and the whole chip row, from one call.
 *
 * Card 0 is the publish; the events are numbered from 1. A group's cards all carry that
 * group's index, so a six-variant test is six cards and ONE number.
 */
export function buildPackaging(input: BuildPackagingInput): { events: PackagingEvent[]; cards: PackagingCard[] } {
  const t0 = new Date(input.originAt).getTime();
  const publishedMs = new Date(input.publishedAt).getTime();
  const series = input.series ?? [];
  const curve = input.curve ?? [];

  const cards: PackagingCard[] = [{
    key: 'start',
    eventKey: 'start',
    index: 0,
    kind: 'start',
    color: 'muted',
    label: [{ kind: 'text', text: 'STARTED' }, { kind: 'time', ms: publishedMs }],
    url: input.publishedUrl,
    title: input.title,
    previousTitle: null,
    winner: false,
  }];
  const events: PackagingEvent[] = [];

  // The title the video wore going into each card, walked forward so a card after a title
  // change shows the new one rather than the video's current one.
  let wornTitle = firstTitle(input.groups, input.title);
  cards[0].title = wornTitle;

  const ordered = [...input.groups].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  ordered.forEach((g, i) => {
    const index = i + 1;
    const kind: PackagingEventKind = g.kind === 'title' ? 'title' : g.kind === 'test' ? 'test' : 'thumbnail';
    const color = EVENT_COLOR[kind];
    const day = Number.isFinite(t0) ? (new Date(g.at).getTime() - t0) / 86_400_000 : NaN;
    const chipUrl = g.kind === 'title'
      ? lastUrlBefore(ordered, i, input.publishedUrl)
      : g.kind === 'swap' ? g.url : (g.variants[g.variants.length - 1]?.url ?? input.publishedUrl);

    events.push({ key: g.key, index, kind, at: g.at, day, url: chipUrl, markerKeys: g.markerKeys });

    const r = ratioAround(series, curve, day);
    const lift = liftLabel(r.before, r.after);
    const offset = Number.isFinite(publishedMs) ? ageOffset(publishedMs, new Date(g.at).getTime()) : null;

    if (g.kind === 'test') {
      const from = new Date(g.at).getTime();
      const to = new Date(g.endAt).getTime();
      g.variants.forEach((v) => {
        const won = g.winner != null && v.label === g.winner;
        cards.push({
          key: `${g.key}:${v.label}`,
          eventKey: g.key,
          index,
          kind: 'test',
          color,
          label: won
            ? [{ kind: 'text', text: String(index) }, { kind: 'text', text: `TEST ${v.label}` }, { kind: 'text', text: 'WINNER' }]
            : [{ kind: 'text', text: String(index) }, { kind: 'text', text: `TEST ${v.label}` }, { kind: 'range', from, to }],
          url: v.url,
          title: wornTitle,
          previousTitle: null,
          winner: won,
        });
      });
      return;
    }

    if (g.kind === 'title') {
      const previous = wornTitle;
      wornTitle = g.title;
      cards.push({
        key: g.key,
        eventKey: g.key,
        index,
        kind: 'title',
        color,
        label: seg(index, 'TITLE', offset, lift),
        url: chipUrl,
        title: g.title,
        previousTitle: previous === g.title ? null : previous,
        winner: false,
      });
      return;
    }

    cards.push({
      key: g.key,
      eventKey: g.key,
      index,
      kind: 'thumbnail',
      color,
      label: seg(index, 'THUMBNAIL', offset, lift),
      url: g.url,
      title: wornTitle,
      previousTitle: null,
      winner: false,
    });
  });

  return { events, cards };
}

function seg(index: number, word: string, offset: string | null, lift: string | null): LabelSegment[] {
  return [
    { kind: 'text' as const, text: String(index) },
    { kind: 'text' as const, text: word },
    ...(offset ? [{ kind: 'text' as const, text: offset }] : []),
    ...(lift ? [{ kind: 'text' as const, text: lift }] : []),
  ];
}

/** The title the video was published under: the first title change's PREVIOUS title. */
function firstTitle(groups: readonly PackagingGroup[], current: string): string {
  for (const g of [...groups].sort((a, b) => (a.at < b.at ? -1 : 1))) {
    if (g.kind === 'title') return g.previousTitle ?? current;
  }
  return current;
}

/** A title change wears whatever image was live at the time — the last one before it. */
function lastUrlBefore(ordered: readonly PackagingGroup[], i: number, fallback: string): string {
  for (let j = i - 1; j >= 0; j--) {
    const g = ordered[j];
    if (g.kind === 'swap') return g.url;
    if (g.kind === 'test') return g.variants[g.variants.length - 1]?.url ?? fallback;
  }
  return fallback;
}

// ------------------------------------------------------------- chips & stacking ----

/** Closer together than this on screen and two chips would overlap, so they stack. */
export const CHIP_MIN_GAP_PX = 56;
export const CHIP_WIDTH_PX = 48;
/** Each further card in a stack peeks out by this much. */
export const STACK_OFFSET_PX = 8;

/** One chip position: a single event, or a stack of them under one index range. */
export interface ChipCluster {
  key: string;
  /** Pixels from the left edge of the PLOT AREA, at the chip's centre. */
  x: number;
  events: PackagingEvent[];
  /** "3" for one, "3–8" for a stack. */
  label: string;
}

/**
 * Where the chips go at the reader's current zoom, and which of them have to share a slot.
 *
 * The collapsing is a function of PIXELS, not of the calendar: two swaps an hour apart are one
 * smudge in a year-long view and two chips once the reader drags into that afternoon.
 */
export function chipClusters(
  events: readonly PackagingEvent[],
  domain: readonly [number, number],
  plotWidth: number,
  minGapPx: number = CHIP_MIN_GAP_PX
): ChipCluster[] {
  const [d0, d1] = domain;
  const span = d1 - d0;
  if (!(span > 0) || !(plotWidth > 0)) return [];
  const visible = events
    .filter((e) => Number.isFinite(e.day) && e.day >= d0 && e.day <= d1)
    .sort((a, b) => a.day - b.day)
    .map((e) => ({ e, x: ((e.day - d0) / span) * plotWidth }));

  const out: ChipCluster[] = [];
  for (const v of visible) {
    const last = out[out.length - 1];
    if (last && v.x - last.x < minGapPx) {
      last.events.push(v.e);
      continue;
    }
    out.push({ key: v.e.key, x: v.x, events: [v.e], label: '' });
  }
  return out.map((c) => ({
    ...c,
    label: c.events.length === 1
      ? String(c.events[0].index)
      : `${c.events[0].index}–${c.events[c.events.length - 1].index}`,
  }));
}

/**
 * The left edge of a popover of `width` anchored on a chip at `x`, kept inside the plot.
 * A popover that runs off the plate is a popover the reader cannot read the end of.
 */
export function clampPopover(x: number, width: number, plotWidth: number): number {
  const ideal = x + CHIP_WIDTH_PX / 2 - width / 2;
  return Math.max(0, Math.min(ideal, Math.max(plotWidth - width, 0)));
}

/** "THUMBNAIL" / "TITLE" / "TEST · 6 VARIANTS" — the words above a stack's popover. */
export function stackLabel(events: readonly PackagingEvent[]): string {
  if (events.length === 1) {
    const e = events[0];
    return e.kind === 'test' ? 'TEST' : e.kind.toUpperCase();
  }
  const kinds = new Set(events.map((e) => e.kind));
  return kinds.size === 1 ? `${events.length} ${[...kinds][0].toUpperCase()}` : `${events.length} CHANGES`;
}
