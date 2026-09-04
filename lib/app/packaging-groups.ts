// The one grouping of a video's packaging history — used by the strip AND by the chart.
//
// thumbnail_versions is a *state* log (scripts/thumbnail-watch.ts diffs each fetch against the
// previous row only), so an A/B rotation that flips back to an earlier image writes a new row
// every time. Version numbers count writes, not decisions. Po_Dh7WLgmM wore two images
// alternating over about two hours and the chart drew "6 swaps": a count of database rows,
// presented to a creator as six things they did.
//
// The strip already knew better — lib/app/packaging-timeline.ts collapsed the same rotation
// into one TEST clip — but it knew it privately, so the two layers disagreed on the same
// screen. The grouping lives here now and both import it: one call, one answer.
//
// The unit is the TEST. What a test *is* comes from lib/app/packaging.ts; this module decides
// the groups, their span, their chip and the marker keys that tie a group to the other layer.
// Pure functions, no I/O.
import { thumbnailVariants, testState } from './packaging';
import { dayRange, type RowVariant, type ThumbRowWithUrl } from './test-row';

export type PackagingTitle = { version: number; title: string; first_seen: string };

export interface GroupPackagingInput {
  publishedAt: string;
  thumbs: ThumbRowWithUrl[];
  titles: PackagingTitle[];
  now?: string | number | Date;
}

interface GroupBase {
  key: string;
  /** When the group starts. A test starts at its FIRST rotation, not at publish. */
  at: string;
  /** A test ends at the settle (or the last rotation while it runs); a rule has no width. */
  endAt: string | null;
  /** The word on the chip the chart draws: "A/B", "swap", "title". */
  chip: string;
  /** Every packagingMarkers() key this group covers, so hovering one layer lights the other. */
  markerKeys: string[];
  /** The images to show small in a tooltip. Empty for a title change. */
  variants: RowVariant[];
}

export type PackagingGroup =
  | (GroupBase & {
      kind: 'test'; endAt: string;
      status: 'testing' | 'settled';
      /** The image the rotation ended on, once it settled. Never drawn as a statistic. */
      winner: string | null;
      /** "2 thumbnails · B won" */
      headline: string;
      /** "Sep 3 – Sep 5" */
      range: string;
    })
  | (GroupBase & { kind: 'swap'; endAt: null; version: number; url: string })
  | (GroupBase & { kind: 'title'; endAt: null; version: number; title: string; previousTitle: string | null });

/** Same shape as components/app/video-chart.tsx markerKey(); restated to keep this pure. */
const markerKey = (kind: string, version: number) => `${kind}-${version}`;

/** "A/B", "A/B/C" — the variants by name. A count of rotations is not a thing a creator did. */
export function testChip(labels: string[]): string {
  return labels.join('/');
}

export function groupPackaging(input: GroupPackagingInput): PackagingGroup[] {
  const thumbs = [...(input.thumbs || [])].sort((a, b) => a.version - b.version);
  const titles = [...(input.titles || [])].sort((a, b) => a.version - b.version);
  const out: PackagingGroup[] = [];

  if (thumbs.length) {
    const state = testState(thumbs, input.now ?? Date.now());
    const { variants } = thumbnailVariants(thumbs);
    const urlFor = new Map(thumbs.map((t) => [t.version, t.url]));
    const changed = thumbs.filter((t) => t.version > thumbs[0].version);
    const rowVariants: RowVariant[] = variants.map((v) => ({
      label: v.label, version: v.versions[0], url: urlFor.get(v.versions[0]) ?? '', current: v.current,
    }));

    if (state.status === 'testing' || state.status === 'settled') {
      // ONE group for the whole rotation, however many state rows it wrote.
      const endAt = state.status === 'settled' ? (state.settledAt as string) : (state.lastFlipAt as string);
      out.push({
        kind: 'test', key: 'test', at: state.startedAt as string, endAt,
        status: state.status, winner: state.winner,
        chip: testChip(rowVariants.map((v) => v.label)),
        headline: state.winner ? `${variants.length} thumbnails · ${state.winner} won` : `${variants.length} thumbnails`,
        range: dayRange(state.startedAt, endAt),
        variants: rowVariants,
        markerKeys: changed.map((t) => markerKey('thumb', t.version)),
      });
    } else if (state.status === 'swap') {
      for (const t of changed) {
        out.push({
          kind: 'swap', key: `swap-${t.version}`, at: t.first_seen, endAt: null,
          version: t.version, url: t.url, chip: 'swap',
          variants: rowVariants, markerKeys: [markerKey('thumb', t.version)],
        });
      }
    }
  }

  for (let i = 1; i < titles.length; i++) {
    const t = titles[i];
    out.push({
      kind: 'title', key: `title-${t.version}`, at: t.first_seen, endAt: null,
      version: t.version, title: t.title, previousTitle: titles[i - 1]?.title ?? null,
      chip: 'title', variants: [], markerKeys: [markerKey('title', t.version)],
    });
  }

  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/** One group placed on the chart's days-since-publish axis. */
export interface PackagingMark {
  key: string;
  kind: 'test' | 'swap' | 'title';
  startDay: number;
  /** The right edge of a shaded window; null for a rule, which has no width. */
  endDay: number | null;
  chip: string;
  markerKeys: string[];
  variants: RowVariant[];
}

/** The same groups the strip drew, on the chart's axis. No second source, no second answer. */
export function packagingMarks(groups: PackagingGroup[], publishedAt: string | Date): PackagingMark[] {
  const t0 = new Date(publishedAt).getTime();
  const day = (at: string) => (new Date(at).getTime() - t0) / 86_400_000;
  if (!Number.isFinite(t0)) return [];
  return groups
    .map((g) => ({
      key: g.key, kind: g.kind, chip: g.chip, markerKeys: g.markerKeys, variants: g.variants,
      startDay: day(g.at),
      endDay: g.endAt ? day(g.endAt) : null,
    }))
    .filter((m) => Number.isFinite(m.startDay) && m.startDay >= 0)
    .sort((a, b) => a.startDay - b.startDay);
}
