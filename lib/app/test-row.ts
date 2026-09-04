// The TEST is the unit, not the version.
//
// One video's thumbnail_versions rows become one row in the feed, in a channel's Changes tab,
// and one clip on the video page's packaging timeline. lib/app/packaging.ts decides what the
// rows *are* (distinct images A/B/C, and whether they read as a running test, a settled one
// or a single swap); this module turns that into the words and the picture slots a row shows.
//
// Deliberately absent, per the product rules: share-of-time, percentages, rotation counts, and
// any "live now" label. We only registered what the watcher saw, so a row says "detected <time>",
// never "started", and during a rotation every variant is live.
//
// And the words claim only what the watcher observed. It hashes images and diffs each against
// the previous state: it sees an image change, and — when an earlier image comes back — a
// rotation. It never sees an experiment, a hypothesis or a result. So the running state is
// ROTATING, not TESTING, and the image a rotation ends on is KEPT, not WINNER: YouTube decides
// winners on watch-time share, which is data we do not have.
//
// Pure functions, no I/O — the components render what these return.
import { thumbnailVariants, testState, type ThumbRow } from './packaging';
import { compactNumber, etTimestamp, sincePublish } from './feed-format';

const ET = 'America/New_York';

/** A thumbnail state row with the image it points at already resolved. */
export type ThumbRowWithUrl = ThumbRow & { url: string };

/** One distinct image in the test, drawn as a deck card or an expanded variant. */
export type RowVariant = {
  label: string;        // A, B, C … in order of first appearance
  version: number;      // the state that first showed it — what the archive URL is keyed by
  url: string;
  /** the latest state shows this image. Never rendered as "live now": during a test all are live. */
  current: boolean;
};

export type TestRowStatus = 'testing' | 'settled' | 'swap';

export type TestRowModel = {
  videoId: string;
  href: string;
  channelId: string | null;
  channelName: string | null;
  title: string;
  /** "Aug 31 · 2.3M views · 1.4×" */
  meta: string;
  status: TestRowStatus;
  /** every distinct image, in first-appearance order */
  variants: RowVariant[];
  /** settled: the image it stopped showing. swap: the image replaced. Drawn small and dimmed. */
  before: RowVariant | null;
  /** settled: the image it ended on. swap: the new image. Drawn large. */
  after: RowVariant | null;
  pill: 'ROTATING' | 'SETTLED' | 'SWAP';
  /** "2 thumbnails" · "kept B" · "New thumbnail" */
  headline: string;
  /** the mono line: when we detected it, or the range it was tested over */
  stamp: string;
  /** latest flip — what the row sorts and groups by */
  at: string;
  /** a swap is one picture replacing another; there is nothing to open */
  expandable: boolean;
};

export type TestRowInput = {
  videoId: string;
  title: string;
  channelId?: string | null;
  channelName?: string | null;
  publishedAt?: string | null;
  views?: number | null;
  score?: number | null;
  thumbs: ThumbRowWithUrl[];
};

/** "Aug 30" — an ET calendar day, short. */
export function etDayShort(at: string | Date | null | undefined): string {
  if (!at) return '';
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { timeZone: ET, month: 'short', day: 'numeric' });
}

/** "Aug 30 – Sep 1", collapsed to one day when both ends land on it. */
export function dayRange(from: string | null, to: string | null): string {
  const a = etDayShort(from), b = etDayShort(to);
  if (!a) return b;
  if (!b || a === b) return a;
  return `${a} – ${b}`;
}

/** Scores read as multiples with the times sign: 1.4×, 12×. */
export function times(score: number | null | undefined): string | null {
  if (score === null || score === undefined || !Number.isFinite(score)) return null;
  return score >= 10 ? `${Math.round(score)}×` : `${(Math.round(score * 10) / 10).toFixed(1)}×`;
}

/** The row's left column, under the video title: "Aug 31 · 2.3M views · 1.4×". */
export function rowMeta(input: { publishedAt?: string | null; views?: number | null; score?: number | null }): string {
  const bits: string[] = [];
  const day = etDayShort(input.publishedAt);
  if (day) bits.push(day);
  if (input.views !== null && input.views !== undefined && Number.isFinite(input.views)) {
    bits.push(`${compactNumber(input.views)} views`);
  }
  const x = times(input.score);
  if (x) bits.push(x);
  return bits.join(' · ');
}

function hoursAfterPublish(at: string, publishedAt: string | null | undefined): number | null {
  if (!publishedAt) return null;
  const h = (new Date(at).getTime() - new Date(publishedAt).getTime()) / 3_600_000;
  return Number.isFinite(h) && h >= 0 ? h : null;
}

/**
 * One video's thumbnail history as a row, or null when there is no test and no swap to show.
 * `now` decides whether a rotation has held long enough to have settled (packaging.ts).
 */
export function buildTestRow(input: TestRowInput, now: string | number | Date = Date.now()): TestRowModel | null {
  const rows = input.thumbs || [];
  const state = testState(rows, now);
  if (state.status === 'none' || !state.lastFlipAt) return null;

  const { variants } = thumbnailVariants(rows);
  const urlFor = new Map(rows.map((r) => [r.version, r.url]));
  const rowVariants: RowVariant[] = variants.map((v) => ({
    label: v.label,
    version: v.versions[0],
    url: urlFor.get(v.versions[0]) ?? '',
    current: v.current,
  }));

  let before: RowVariant | null = null;
  let after: RowVariant | null = null;
  let pill: TestRowModel['pill'] = 'ROTATING';
  let headline = '';
  let stamp = '';

  if (state.status === 'settled') {
    pill = 'SETTLED';
    after = rowVariants.find((v) => v.label === state.winner) ?? null;
    // The most recently introduced image that is not the winner — the one it beat.
    before = [...rowVariants].reverse().find((v) => v.label !== state.winner) ?? null;
    // "kept", not "won": we saw which image it settled on, not which one performed.
    headline = `kept ${state.winner}`;
    stamp = `rotated ${dayRange(state.startedAt, state.settledAt)}`;
  } else if (state.status === 'swap') {
    pill = 'SWAP';
    before = rowVariants[0] ?? null;
    after = rowVariants[rowVariants.length - 1] ?? null;
    headline = 'New thumbnail';
    const since = sincePublish(hoursAfterPublish(state.lastFlipAt, input.publishedAt));
    // "detected", never "started": we only registered what the watcher saw.
    stamp = since ? `${etTimestamp(state.lastFlipAt)} · ${since}` : etTimestamp(state.lastFlipAt);
  } else {
    pill = 'ROTATING';
    headline = `${variants.length} thumbnails`;
    stamp = `detected ${etTimestamp(state.lastFlipAt)}`;
  }

  return {
    videoId: input.videoId,
    href: `/app/videos/${input.videoId}`,
    channelId: input.channelId ?? null,
    channelName: input.channelName ?? null,
    title: input.title,
    meta: rowMeta(input),
    status: state.status,
    variants: rowVariants,
    before,
    after,
    pill,
    headline,
    stamp,
    at: state.lastFlipAt,
    expandable: state.status !== 'swap' && rowVariants.length > 1,
  };
}

/** Newest activity first — the order every list of these rows uses. */
export function sortTestRows(rows: TestRowModel[]): TestRowModel[] {
  return [...rows].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
