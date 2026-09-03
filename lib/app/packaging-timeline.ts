// The video page's packaging history as a left-to-right track of clips.
//
// Same rule as everywhere else: the unit is the TEST, not the version. A rotation that flipped
// A → B → A is one TEST clip that opens to show its variants, not three thumbnail clips. What a
// clip *is* comes from lib/app/packaging.ts; this module only decides the order, the words and
// the hover key that ties a clip to its marker on the chart above.
//
// Pure functions, no I/O.
import { thumbnailVariants, testState, type ThumbRow } from './packaging';
import { etTimestamp } from './feed-format';
import { dayRange, etDayShort, times, type RowVariant, type ThumbRowWithUrl } from './test-row';

export type TimelineTitle = { version: number; title: string; first_seen: string };

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
      range: string;               // "Aug 30 – Sep 1"
      /** every thumbnail marker this test covers, so hovering the clip lights all of them */
      markerKeys: string[];
    }
  | { kind: 'title'; key: string; at: string; url: string; title: string; label: string; markerKeys: string[] }
  | { kind: 'swap'; key: string; at: string; url: string; title: string; label: string; markerKeys: string[] }
  | { kind: 'now'; key: string; at: string; url: string; title: string; score: number | null };

export type TimelineInput = {
  publishedAt: string;
  thumbs: ThumbRowWithUrl[];
  titles: TimelineTitle[];
  score?: number | null;
  now?: string | number | Date;
};

/** Same shape as components/app/video-chart.tsx markerKey(); duplicated here to keep this pure. */
const key = (kind: string, version: number) => `${kind}-${version}`;

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

export function buildTimeline(input: TimelineInput): TimelineClip[] {
  const thumbs = [...(input.thumbs || [])].sort((a, b) => a.version - b.version);
  const titles = [...(input.titles || [])].sort((a, b) => a.version - b.version);
  if (!thumbs.length) return [];

  const clips: TimelineClip[] = [];
  const first = thumbs[0];
  clips.push({
    kind: 'published', key: 'published', at: input.publishedAt,
    url: first.url, title: titles[0]?.title ?? '',
    label: `PUBLISHED · ${etTimestamp(input.publishedAt)}`,
  });

  const state = testState(thumbs, input.now ?? Date.now());
  const { variants } = thumbnailVariants(thumbs);
  const urlFor = new Map(thumbs.map((t) => [t.version, t.url]));
  const changed = thumbs.filter((t) => t.version > first.version);

  if (state.status === 'testing' || state.status === 'settled') {
    // One clip for the whole experiment. Rotation counts stay out of the words.
    const rowVariants: RowVariant[] = variants.map((v) => ({
      label: v.label, version: v.versions[0], url: urlFor.get(v.versions[0]) ?? '', current: v.current,
    }));
    const endAt = state.status === 'settled' ? (state.settledAt as string) : (state.lastFlipAt as string);
    clips.push({
      kind: 'test', key: 'test', at: state.startedAt as string, endAt,
      url: rowVariants[rowVariants.length - 1]?.url ?? first.url,
      backUrl: rowVariants[0]?.url ?? null,
      variants: rowVariants,
      title: titleAt(titles, state.startedAt as string),
      headline: state.winner
        ? `${variants.length} thumbnails · ${state.winner} won`
        : `${variants.length} thumbnails`,
      range: dayRange(state.startedAt, endAt),
      markerKeys: changed.map((t) => key('thumb', t.version)),
    });
  } else if (state.status === 'swap') {
    for (const t of changed) {
      clips.push({
        kind: 'swap', key: `swap-${t.version}`, at: t.first_seen, url: t.url,
        title: titleAt(titles, t.first_seen),
        label: `SWAP · ${etTimestamp(t.first_seen)}`,
        markerKeys: [key('thumb', t.version)],
      });
    }
  }

  for (const t of titles.slice(1)) {
    clips.push({
      kind: 'title', key: `title-${t.version}`, at: t.first_seen,
      url: thumbAt(thumbs, t.first_seen), title: t.title,
      label: `TITLE · ${etTimestamp(t.first_seen)}`,
      markerKeys: [key('title', t.version)],
    });
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
 * The mono date ruler above the track: evenly spaced ET days from publish to the last clip.
 * Ticks are a reading aid, not a scale — the clips are equal width, so this says roughly
 * "when", never "how long each thing lasted".
 */
export function timelineTicks(clips: TimelineClip[], max = 5): string[] {
  if (!clips.length) return [];
  const from = new Date(clips[0].at).getTime();
  const to = new Date(clips[clips.length - 1].at).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [etDayShort(clips[0].at)];
  const n = Math.max(2, Math.min(max, clips.length));
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const label = etDayShort(new Date(from + ((to - from) * i) / (n - 1)).toISOString());
    if (label !== out[out.length - 1]) out.push(label);
  }
  return out;
}
