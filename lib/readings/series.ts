// The per-video series file: everything the video chart draws, as one object on R2.
//
// WHY A FILE PER VIDEO. The chart needs a video's whole reading history at once. In Postgres
// that is three range scans over the three biggest tables in the database (view_snapshots,
// view_samples, rss_samples) on every page view. On R2 it is one GET of an object that is
// already exactly the answer. Postgres keeps what the product *decides* with (the score, the
// params, the bands — small, indexed, changing hourly); R2 keeps what it *draws*.
//
// WHY GZIPPED JSON, not parquet. A series is one video's few thousand points, read whole, in a
// request path. Parquet's column pruning buys nothing when every column is wanted, and its
// decoder is heavier than zlib + JSON.parse. Measured shape: a two-year video with hourly
// readings is ~50 KB of JSON, ~6 KB gzipped. The day-partitioned parquet archive
// (lib/readings/archive.ts) stays the analytics format; this is the serving format.
//
// WHY THE RAW ROWS, not the drawn line. Two consumers filter rss differently — the page wants
// `views is not null and not conflicted`, the scorer wants `model_eligible and not conflicted`
// (lib/scoring/observations.ts) — so the file carries the flags and the reader decides. Bake the
// filter in and the file can only ever serve one of them.
//
// Everything here is pure: keys, encoding, and the row shapes. The I/O is series-store.ts.

import { gzipSync, gunzipSync } from 'node:zlib';

export const SERIES_VERSION = 1 as const;

/** A view_snapshots row, as the page's query already shapes it (`at` is the noon-UTC anchor). */
export interface SeriesSnapshot {
  at: string;
  created_at: string | null;
  views: number;
  days_since_published: number | null;
  like_count: number | null;
  comment_count: number | null;
}

/** A view_samples row: the paid API's timed reading. */
export interface SeriesSample { at: string; views: number }

/**
 * An rss_samples row, unfiltered. `eligible` is the table's `model_eligible` and `conflicted`
 * its `conflicted`; both consumers' predicates are applied by seriesRss(), not baked in here.
 */
export interface SeriesRss {
  at: string;
  views: number | null;
  timeBasis?: string | null;
  receivedAt?: string | null;
  eligible: boolean;
  conflicted: boolean;
}

/** The packaging version markers the chart puts on its axis. */
export interface SeriesThumb {
  version: number;
  first_seen: string;
  last_checked: string | null;
  sha256: string | null;
  phash: string | null;
  r2_uploaded_at: string | null;
}
export interface SeriesTitle { version: number; title: string; first_seen: string }

export interface VideoSeriesFile {
  v: typeof SERIES_VERSION;
  video_id: string;
  /** Denormalised so a reader can date the points without a videos read. */
  published_at: string | null;
  /** When this file was last rebuilt — the number the fallback-rate log reports staleness from. */
  built_at: string;
  snapshots: SeriesSnapshot[];
  samples: SeriesSample[];
  rss: SeriesRss[];
  thumbs: SeriesThumb[];
  titles: SeriesTitle[];
}

/** `series/<video_id>.json.gz`. Flat: R2 has no directories and a video id is already unique. */
export function seriesKey(videoId: string): string {
  if (!videoId || /[/\s]/.test(videoId)) throw new Error(`bad video id for series key: ${videoId}`);
  return `series/${videoId}.json.gz`;
}

export const SERIES_CONTENT_TYPE = 'application/gzip';

const iso = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(v as string);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};
const num = (v: unknown): number | null =>
  v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null;

/**
 * Build a file from the rows Postgres returns. Sorting is done here rather than trusted from the
 * query so a backfill that unions Postgres and parquet still produces one canonical order — and
 * so two builds of the same video are byte-identical, which is what makes the equality test a
 * test of the *data* rather than of the query plan.
 */
export function buildSeriesFile(input: {
  videoId: string;
  publishedAt?: string | Date | null;
  snapshots?: readonly Record<string, unknown>[];
  samples?: readonly Record<string, unknown>[];
  rss?: readonly Record<string, unknown>[];
  thumbs?: readonly Record<string, unknown>[];
  titles?: readonly Record<string, unknown>[];
  builtAt?: string | Date;
}): VideoSeriesFile {
  const byAt = (a: { at: string }, b: { at: string }) => Date.parse(a.at) - Date.parse(b.at);
  const snapshots: SeriesSnapshot[] = (input.snapshots ?? [])
    .map((r) => ({
      at: iso(r.at) ?? '',
      created_at: iso(r.created_at),
      views: num(r.views) ?? 0,
      days_since_published: num(r.days_since_published),
      like_count: num(r.like_count),
      comment_count: num(r.comment_count),
    }))
    .filter((r) => r.at)
    .sort(byAt);
  const samples: SeriesSample[] = (input.samples ?? [])
    .map((r) => ({ at: iso(r.at) ?? '', views: num(r.views) ?? 0 }))
    .filter((r) => r.at)
    .sort(byAt);
  const rss: SeriesRss[] = (input.rss ?? [])
    .map((r) => ({
      at: iso(r.at) ?? '',
      views: num(r.views),
      timeBasis: (r.timeBasis ?? r.time_basis ?? null) as string | null,
      receivedAt: iso(r.receivedAt ?? r.received_at),
      // Absent columns default to "usable": a row that reached the archive without the flag
      // must not silently vanish from the chart.
      eligible: r.eligible === undefined && r.model_eligible === undefined
        ? true : Boolean(r.eligible ?? r.model_eligible),
      conflicted: Boolean(r.conflicted ?? false),
    }))
    .filter((r) => r.at)
    .sort(byAt);
  const thumbs: SeriesThumb[] = (input.thumbs ?? [])
    .map((r) => ({
      version: Number(r.version),
      first_seen: iso(r.first_seen) ?? '',
      last_checked: iso(r.last_checked),
      sha256: (r.sha256 ?? null) as string | null,
      phash: (r.phash ?? null) as string | null,
      r2_uploaded_at: iso(r.r2_uploaded_at),
    }))
    .filter((r) => Number.isFinite(r.version))
    .sort((a, b) => a.version - b.version);
  const titles: SeriesTitle[] = (input.titles ?? [])
    .map((r) => ({ version: Number(r.version), title: String(r.title ?? ''), first_seen: iso(r.first_seen) ?? '' }))
    .filter((r) => Number.isFinite(r.version))
    .sort((a, b) => a.version - b.version);
  return {
    v: SERIES_VERSION,
    video_id: input.videoId,
    published_at: iso(input.publishedAt),
    built_at: (input.builtAt ? new Date(input.builtAt) : new Date()).toISOString(),
    snapshots, samples, rss, thumbs, titles,
  };
}

/**
 * Deduplicate on the reading's own clock, later build wins. The backfill unions Postgres (which
 * has been thinned) with the parquet archive (which has not), and the overlap is exact
 * duplicates — the same reading written twice, once to each store.
 */
export function mergeSeriesFiles(a: VideoSeriesFile, b: VideoSeriesFile): VideoSeriesFile {
  const dedupe = <T extends { at: string }>(xs: T[], ys: T[]): T[] => {
    const m = new Map<string, T>();
    for (const r of xs) m.set(r.at, r);
    for (const r of ys) m.set(r.at, r);        // later argument wins
    return [...m.values()].sort((p, q) => Date.parse(p.at) - Date.parse(q.at));
  };
  const byVersion = <T extends { version: number }>(xs: T[], ys: T[]): T[] => {
    const m = new Map<number, T>();
    for (const r of [...xs, ...ys]) m.set(r.version, r);
    return [...m.values()].sort((p, q) => p.version - q.version);
  };
  return {
    v: SERIES_VERSION,
    video_id: a.video_id || b.video_id,
    published_at: a.published_at ?? b.published_at,
    built_at: new Date(Math.max(Date.parse(a.built_at) || 0, Date.parse(b.built_at) || 0)).toISOString(),
    snapshots: dedupe(a.snapshots, b.snapshots),
    samples: dedupe(a.samples, b.samples),
    rss: dedupe(a.rss, b.rss),
    thumbs: byVersion(a.thumbs, b.thumbs),
    titles: byVersion(a.titles, b.titles),
  };
}

export function encodeSeries(file: VideoSeriesFile): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(file), 'utf8'), { level: 9 });
}

/** null rather than a throw for anything unreadable or from a future version: a bad file is a
 *  cache miss, and the caller falls back to Postgres and logs it. */
export function decodeSeries(buf: Buffer): VideoSeriesFile | null {
  try {
    const parsed = JSON.parse(gunzipSync(buf).toString('utf8')) as VideoSeriesFile;
    if (!parsed || parsed.v !== SERIES_VERSION || !Array.isArray(parsed.snapshots)) return null;
    return parsed;
  } catch { return null; }
}

/**
 * The rss rows a given consumer may use.
 *   'page'  — lib/admin/queries.ts videoPage(): `views is not null and not conflicted`
 *   'model' — lib/scoring/observations.ts OBSERVATION_RECORDS_SQL: `model_eligible and not conflicted`
 * Both predicates live here so the two are never accidentally made the same.
 */
export function seriesRss(file: VideoSeriesFile, mode: 'page' | 'model'): SeriesRss[] {
  return file.rss.filter((r) => !r.conflicted && (mode === 'page' ? r.views !== null : r.eligible));
}
