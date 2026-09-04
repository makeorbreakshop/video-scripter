// The video page's packaging history as a left-to-right track of clips.
//
// Same rule as everywhere else: the unit is the TEST, not the version. A rotation that flipped
// A → B → A is one TEST clip that opens to show its variants, not three thumbnail clips. What a
// clip *is* comes from lib/app/packaging.ts; this module only decides the order, the words and
// the hover key that ties a clip to its marker on the chart above.
//
// Pure functions, no I/O.
import { groupPackaging } from './packaging-groups';
import { times, type RowVariant, type ThumbRowWithUrl } from './test-row';

export type TimelineTitle = { version: number; title: string; first_seen: string };

/**
 * The clips carry INSTANTS, not formatted times.
 *
 * They are built on the server and read by a client component, and the app writes every time in
 * the reader's own zone (lib/app/local-time.ts) — so a string formatted here would be the
 * server's zone and would disagree with the browser's. `label` is the kind word alone
 * ("PUBLISHED", "SWAP", "TITLE") and the strip appends the local time it renders itself.
 */
export type TimelineClip =
  | { kind: 'published'; key: string; at: string; url: string; title: string; label: string }
  | {
      kind: 'test'; key: string; at: string; endAt: string;
      url: string;                 // the deck's front card
      backUrl: string | null;      // the card behind it
      variants: RowVariant[];
      title: string;
      /** "2 thumbnails · B won", or just "2 thumbnails" while it is still running */
      headline: string;
      /** ET, kept for any server-side reader; the strip draws `at`..`endAt` in the local zone. */
      range: string;               // "Aug 30 – Sep 1"
      /** every thumbnail marker this test covers, so hovering the clip lights all of them */
      markerKeys: string[];
    }
  | { kind: 'title'; key: string; at: string; url: string; title: string; label: string; markerKeys: string[] }
  | { kind: 'swap'; key: string; at: string; url: string; title: string; label: string; markerKeys: string[] }
  | { kind: 'now'; key: string; at: string; url: string; title: string; score: number | null }
  /**
   * The whole history, when there is none. One thumbnail version and no title past v1 means the
   * video is wearing exactly what it was published in — and the strip was drawing that as TWO
   * cards, a PUBLISHED and a NOW showing the same image and the same title, which reads as a
   * change that happened and asks the reader to compare two identical pictures. It is one card.
   */
  | { kind: 'unchanged'; key: string; at: string; url: string; title: string; label: string };

export type TimelineInput = {
  publishedAt: string;
  thumbs: ThumbRowWithUrl[];
  titles: TimelineTitle[];
  score?: number | null;
  now?: string | number | Date;
};

/** The title the video wore at `at` — what a clip that is not itself a title change shows. */
function titleAt(titles: TimelineTitle[], at: string): string {
  const sorted = [...titles].sort((a, b) => a.version - b.version);
  let out = sorted[0]?.title ?? '';
  for (const t of sorted) if (new Date(t.first_seen).getTime() <= new Date(at).getTime()) out = t.title;
  return out;
}

/** The image the video wore at `at`. */
function thumbAt(thumbs: ThumbRowWithUrl[], at: string): string {
  const sorted = [...thumbs].sort((a, b) => a.version - b.version);
  let out = sorted[0]?.url ?? '';
  for (const t of sorted) if (new Date(t.first_seen).getTime() <= new Date(at).getTime()) out = t.url;
  return out;
}

/**
 * True when the whole "history" is "nothing happened". The timeline then draws a 200px card
 * frame around an empty thumbnail slot with a lowercase caption under it, which reads as a
 * failed image load rather than as an answer — so the page says the sentence instead.
 */
export function isUnchangedOnly(clips: TimelineClip[]): boolean {
  return clips.length === 1 && clips[0].kind === 'unchanged';
}

export function buildTimeline(input: TimelineInput): TimelineClip[] {
  const thumbs = [...(input.thumbs || [])].sort((a, b) => a.version - b.version);
  const titles = [...(input.titles || [])].sort((a, b) => a.version - b.version);
  if (!thumbs.length) return [];

  const first = thumbs[0];

  // Nothing ever changed: one card, not a before and an identical after.
  if (thumbs.length === 1 && titles.length <= 1) {
    return [{
      kind: 'unchanged', key: 'unchanged', at: input.publishedAt,
      url: first.url, title: titles[0]?.title ?? '',
      label: 'no changes since publish',
    }];
  }

  const clips: TimelineClip[] = [];
  clips.push({
    kind: 'published', key: 'published', at: input.publishedAt,
    url: first.url, title: titles[0]?.title ?? '',
    label: 'PUBLISHED',
  });

  // The grouping is NOT decided here: lib/app/packaging-groups.ts is the one answer, and the
  // chart above reads exactly the same call. When it lived in this file the two layers could
  // (and did) disagree — one A/B test in the strip, "6 swaps" on the chart.
  const groups = groupPackaging({
    publishedAt: input.publishedAt, thumbs, titles, now: input.now ?? Date.now(),
  });

  for (const g of groups) {
    if (g.kind === 'test') {
      clips.push({
        kind: 'test', key: g.key, at: g.at, endAt: g.endAt,
        url: g.variants[g.variants.length - 1]?.url ?? first.url,
        backUrl: g.variants[0]?.url ?? null,
        variants: g.variants,
        title: titleAt(titles, g.at),
        headline: g.headline,
        range: g.range,
        markerKeys: g.markerKeys,
      });
    } else if (g.kind === 'swap') {
      clips.push({
        kind: 'swap', key: g.key, at: g.at, url: g.url,
        title: titleAt(titles, g.at),
        label: 'SWAP',
        markerKeys: g.markerKeys,
      });
    } else {
      clips.push({
        kind: 'title', key: g.key, at: g.at,
        url: thumbAt(thumbs, g.at), title: g.title,
        label: 'TITLE',
        markerKeys: g.markerKeys,
      });
    }
  }

  clips.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  const latest = thumbs[thumbs.length - 1];
  clips.push({
    kind: 'now', key: 'now', at: latest.first_seen, url: latest.url,
    title: titles[titles.length - 1]?.title ?? '', score: input.score ?? null,
  });
  return clips;
}

/** "NOW · 1.2×" — the accent line under the last clip. */
export function nowLabel(score: number | null | undefined): string {
  const x = times(score);
  return x ? `NOW · ${x}` : 'NOW';
}

/**
 * The mono date ruler above the track: evenly spaced INSTANTS from publish to the last clip, as
 * epoch milliseconds. Ticks are a reading aid, not a scale — the clips are equal width, so this
 * says roughly "when", never "how long each thing lasted".
 *
 * Milliseconds rather than day strings, for the same reason the clips carry instants: the strip
 * is a client component and writes them in the reader's zone. Two ticks that fall on one of the
 * reader's days collapse THERE, not here — which day two instants share depends on the zone.
 */
export function timelineTicks(clips: TimelineClip[], max = 5): number[] {
  if (!clips.length) return [];
  const from = new Date(clips[0].at).getTime();
  const to = new Date(clips[clips.length - 1].at).getTime();
  if (!Number.isFinite(from)) return [];
  if (!Number.isFinite(to) || to <= from) return [from];
  const n = Math.max(2, Math.min(max, clips.length));
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(from + ((to - from) * i) / (n - 1));
  return out;
}
