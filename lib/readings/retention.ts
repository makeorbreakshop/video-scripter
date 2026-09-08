// Time-series retention policy: what Postgres keeps, and what may be deleted.
//
// Postgres is a serving store, not the archive. R2 (lib/readings/archive.ts) keeps every raw
// reading forever; Postgres keeps only the resolution a reader can actually see:
//
//   age < 7 days     every reading, untouched — the window the scorer and the launch tracker
//                    read at full density, and the window the chart draws hour by hour.
//   7 .. 30 days     one reading per video per UTC hour. Past a week the drawn line is a day
//                    wide on screen; 96 readings inside one hour draw the same pixel.
//   > 30 days        one reading per video per UTC day. view_snapshots already holds a daily
//                    truth, so this tier is the fallback for videos that have no snapshot, not
//                    a duplicate of one.
//
// THE RULE (isThinnable / assertThinnable): a row is only ever deleted from Postgres after the
// day containing it has been written to R2, read back, and matched on both row count and
// checksum. Disk pressure is preferable to data loss.
//
// Everything here is pure. The I/O lives in scripts/archive-readings.ts and
// scripts/thin-readings.ts; retention.test.ts is the specification.
//
// node:crypto is imported statically. A lazy require() here fails under ESM with
// ERR_AMBIGUOUS_MODULE_SYNTAX once any importer uses top-level await, which every one of the
// scripts does. This module is server-side only — nothing in a client bundle reaches it.
import { createHash } from 'node:crypto';

export const READING_RETENTION = {
  /** Readings younger than this keep their full native resolution. */
  denseWindowDays: 7,
  /** Between denseWindowDays and this, one reading per video per UTC hour survives. */
  hourlyWindowDays: 30,
  /**
   * A video's first days are never thinned below hourly, however old the readings get.
   *
   * This is not a nicety. Verified 2026-09-08 with scripts/verify-archive.ts: applying the plain
   * age tiers to KFVqHUvp-0w moved the drawn line by 213 % two hours after publish, because the
   * daily tier collapses a launch day's 96 readings to two. The launch window is the steepest
   * part of every curve, the part the page is mostly looked at for, and the part the scorer's
   * early anchors come from. Keeping it hourly forever costs ~72 rows per video, once.
   */
  launchWindowDays: 1,
  /**
   * And the first hours are not thinned at all. An hour bucket still draws a chord across the
   * steepest part of the curve: with launchWindowDays alone the line still moved 2.2 % two hours
   * after publish (KFVqHUvp-0w). Native 15-minute resolution for this long takes that to zero.
   */
  launchDenseHours: 6,
  /** Rows deleted per statement. Kept well under a lock-worrying size. */
  batchSize: 20_000,
  /** video_score_history keeps this many days in Postgres; older rows live only in R2. */
  historyDays: 14,
} as const;

export type ReadingSource = 'rss' | 'api';

export interface Reading {
  video_id: string;
  /** The measurement's own clock. */
  at: Date | string;
  /** The video's publish time, when known. Only used to protect the launch window. */
  published_at?: Date | string | null;
  views: number | string | null;
  likes?: number | string | null;
  source?: ReadingSource;
  time_basis?: string | null;
}

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

/** Epoch millis, or NaN for anything we cannot date. */
export function ms(at: Date | string | number): number {
  if (at instanceof Date) return at.getTime();
  if (typeof at === 'number') return at;
  return new Date(at).getTime();
}

/** UTC calendar day of a reading, `YYYY-MM-DD`. The partition unit everywhere. */
export function utcDay(at: Date | string | number): string {
  return new Date(ms(at)).toISOString().slice(0, 10);
}

/** UTC hour bucket key, `YYYY-MM-DDTHH`. */
export function utcHour(at: Date | string | number): string {
  return new Date(ms(at)).toISOString().slice(0, 13);
}

/** The tier a reading falls in at a given moment. */
export type Tier = 'dense' | 'hourly' | 'daily';

export function tierOf(
  at: Date | string | number,
  now: Date | number = new Date(),
  policy: typeof READING_RETENTION = READING_RETENTION
): Tier {
  const age = (ms(now) - ms(at)) / DAY_MS;
  if (age < policy.denseWindowDays) return 'dense';
  if (age < policy.hourlyWindowDays) return 'hourly';
  return 'daily';
}

/**
 * Later wins; ties on `at` break on the string form of any id, so the choice is deterministic
 * and reproducible between this and the SQL's `order by at desc, ctid desc`.
 */
function newer(a: Reading, b: Reading): boolean {
  const at = ms(a.at), bt = ms(b.at);
  if (at !== bt) return at > bt;
  return String((a as unknown as { id?: unknown }).id ?? '') >
         String((b as unknown as { id?: unknown }).id ?? '');
}

/** A reading taken inside the video's launch window keeps hourly resolution for ever. */
export function inLaunchWindow(
  r: Reading, t: number = ms(r.at), policy: typeof READING_RETENTION = READING_RETENTION
): boolean {
  if (r.published_at == null) return false;
  const p = ms(r.published_at);
  return Number.isFinite(p) && t < p + policy.launchWindowDays * DAY_MS;
}

/** A reading in the video's first hours is never thinned at all, at any age. */
export function inLaunchDense(
  r: Reading, t: number = ms(r.at), policy: typeof READING_RETENTION = READING_RETENTION
): boolean {
  if (r.published_at == null) return false;
  const p = ms(r.published_at);
  return Number.isFinite(p) && t < p + policy.launchDenseHours * HOUR_MS;
}

/**
 * Which rows survive a thinning pass:
 *
 *   - everything inside the dense window;
 *   - the LAST reading of each (video, hour) in the hourly tier and each (video, day) in the
 *     daily tier;
 *   - the FIRST reading of each (video, UTC day), in every thinned tier.
 *
 * That last rule is not tidiness, it is the scorer. `growthExponent` (lib/scoring/core.ts) is
 * `log(last.views / first.views) / log((last.day+1) / (first.day+1))` — it reads ONLY the
 * earliest and the latest reading of a video. The latest is safe for free (the survivor of a
 * bucket IS its last row), but without this rule the earliest reading of a video's first day
 * would be thinned away and `first` would slide forward by up to an hour, moving q and with it
 * the score. Keeping it costs one row per video per day.
 *
 * A row whose `at` will not parse is always kept — we never delete what we cannot place in time.
 */
export function survivingReadings<T extends Reading>(
  rows: readonly T[],
  now: Date | number = new Date(),
  policy: typeof READING_RETENTION = READING_RETENTION
): T[] {
  const keep = new Set<T>();
  const last = new Map<string, T>();
  const first = new Map<string, T>();
  for (const r of rows) {
    const t = ms(r.at);
    if (!Number.isFinite(t)) { keep.add(r); continue; }
    const tier = tierOf(t, now, policy);
    if (tier === 'dense' || inLaunchDense(r, t, policy)) { keep.add(r); continue; }
    const bucket = tier === 'hourly' || inLaunchWindow(r, t, policy) ? utcHour(t) : utcDay(t);
    const lk = `${r.video_id} ${bucket}`;
    const cur = last.get(lk);
    if (!cur || newer(r, cur)) last.set(lk, r);
    // Partitioned on positive-vs-zero as well as on the day, because growthExponent() drops
    // non-positive readings before taking the first one: without this, a video whose first
    // reading is a zero would have its first REAL reading thinned away and q would move.
    const fk = `${r.video_id} ${utcDay(t)} ${Number(r.views) > 0}`;
    const f = first.get(fk);
    if (!f || newer(f, r)) first.set(fk, r);
  }
  for (const r of last.values()) keep.add(r);
  for (const r of first.values()) keep.add(r);
  return rows.filter((r) => keep.has(r));
}

/** The complement of survivingReadings: exactly the rows a pass would delete. */
export function doomedReadings<T extends Reading>(
  rows: readonly T[],
  now: Date | number = new Date(),
  policy: typeof READING_RETENTION = READING_RETENTION
): T[] {
  const survivors = new Set(survivingReadings(rows, now, policy));
  return rows.filter((r) => !survivors.has(r));
}

// ---- partition keys -------------------------------------------------------------------
// One object per (source, UTC day). Sorted by video_id inside, so a per-video slice is a
// contiguous run of rows and the index file below turns it into a bounded read.

export function assertDay(day: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`not a UTC day: ${JSON.stringify(day)}`);
}

export function readingsKey(source: ReadingSource, day: string, part = 0): string {
  assertDay(day);
  return `readings/source=${source}/day=${day}/part-${part}.parquet`;
}

export function readingsIndexKey(source: ReadingSource, day: string): string {
  assertDay(day);
  return `readings/source=${source}/day=${day}/index.json`;
}

export function historyKey(day: string, part = 0): string {
  assertDay(day);
  return `history/day=${day}/part-${part}.parquet`;
}

/** video_id -> [firstRowOffset, rowCount] over a part file whose rows are sorted by video_id. */
export type RowRangeIndex = Record<string, [number, number]>;

export function buildRowIndex(rows: readonly Reading[]): RowRangeIndex {
  const idx: RowRangeIndex = {};
  for (let i = 0; i < rows.length; i++) {
    const id = rows[i].video_id;
    const cur = idx[id];
    if (!cur) idx[id] = [i, 1];
    else cur[1]++;
  }
  return idx;
}

/** The archive's canonical row order: video_id, then time, so a video's readings are one run. */
export function sortForArchive<T extends Reading>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) =>
    a.video_id < b.video_id ? -1 : a.video_id > b.video_id ? 1 : ms(a.at) - ms(b.at));
}

// ---- checksum -------------------------------------------------------------------------
// The only thing that authorises a delete. Deliberately narrow: (video_id, at, views) is what a
// reader can observe, and it is computed identically from a Postgres result set and from a
// parquet file read back out of R2.

/** The exact bytes hashed, one line per row, in sortForArchive order. */
export function checksumLines(rows: readonly Reading[]): string {
  return sortForArchive(rows)
    .map((r) => `${r.video_id}|${ms(r.at)}|${r.views == null ? '' : String(r.views)}`)
    .join('\n');
}

/** sha256 of checksumLines, hex. */
export function checksum(rows: readonly Reading[]): string {
  return createHash('sha256').update(checksumLines(rows), 'utf8').digest('hex');
}

/**
 * The same digest, computed incrementally. A day of rss_samples is ~1.7 M rows, which is not a
 * thing to hold in memory twice, so the archive writer streams the day in video_id order —
 * which IS sortForArchive order — and feeds each chunk through here. `push` must be called in
 * that order; out-of-order input silently produces a different digest, which is exactly what
 * the verification is for.
 */
export function checksumStream() {
  const h = createHash('sha256');
  let n = 0;
  return {
    push(rows: readonly Reading[]) {
      for (const r of rows) {
        if (n > 0) h.update('\n');
        h.update(`${r.video_id}|${ms(r.at)}|${r.views == null ? '' : String(r.views)}`);
        n++;
      }
    },
    get rows() { return n; },
    digest(): string { return h.digest('hex'); },
  };
}

// ---- keyset batching ------------------------------------------------------------------
// rss_samples and view_samples are both keyed (video_id, at). A delete walks that key forward
// rather than re-scanning from the start, so pass N+1 does not re-read pass N's work.

export type ReadingKey = { video_id: string; at: number };

export function keyOf(r: Reading): ReadingKey {
  return { video_id: r.video_id, at: ms(r.at) };
}

/** Split keys into statement-sized batches, in key order, never exceeding batchSize. */
export function keysetBatches(
  keys: readonly ReadingKey[],
  batchSize: number = READING_RETENTION.batchSize
): ReadingKey[][] {
  if (!Number.isInteger(batchSize) || batchSize <= 0) throw new Error(`bad batchSize ${batchSize}`);
  const ordered = [...keys].sort((a, b) =>
    a.video_id < b.video_id ? -1 : a.video_id > b.video_id ? 1 : a.at - b.at);
  const out: ReadingKey[][] = [];
  for (let i = 0; i < ordered.length; i += batchSize) out.push(ordered.slice(i, i + batchSize));
  return out;
}

/** The cursor a keyset scan resumes from: the last key of the batch just handled. */
export function cursorAfter(batch: readonly ReadingKey[]): ReadingKey | null {
  return batch.length ? batch[batch.length - 1] : null;
}

// ---- the survivor-must-be-verified rule -----------------------------------------------

/** One row of the readings_archive_days ledger. */
export interface ArchivedDay {
  day: string;
  source: ReadingSource | 'history';
  rows: number;
  bytes: number;
  checksum: string;
  verified_at: Date | string | null;
}

/**
 * Whether a (day, source) may be thinned or deleted in Postgres. True only when the ledger says
 * the day was written AND read back AND matched. A verified empty day is thinnable — there is
 * nothing to lose.
 */
export function isThinnable(
  day: string,
  source: ReadingSource | 'history',
  ledger: readonly ArchivedDay[]
): boolean {
  assertDay(day);
  const row = ledger.find((d) => d.day === day && d.source === source);
  return !!row && !!row.verified_at && typeof row.checksum === 'string' && row.checksum.length === 64;
}

/** The days a thinning pass is allowed to touch, given the days it wanted to touch. */
export function thinnableDays(
  wanted: readonly string[],
  source: ReadingSource | 'history',
  ledger: readonly ArchivedDay[]
): string[] {
  return wanted.filter((d) => isThinnable(d, source, ledger));
}

/** Loud version, for the delete path. A caller must not be able to "handle" this and continue. */
export function assertThinnable(
  day: string,
  source: ReadingSource | 'history',
  ledger: readonly ArchivedDay[]
): void {
  if (!isThinnable(day, source, ledger)) {
    throw new Error(
      `refusing to delete ${source} readings for ${day}: not verified in R2 ` +
      `(run scripts/archive-readings.ts --day ${day} first)`
    );
  }
}

/** UTC days in [from, to], inclusive, oldest first. */
export function dayRange(from: Date | string | number, to: Date | string | number): string[] {
  const start = Date.parse(utcDay(from) + 'T00:00:00.000Z');
  const end = Date.parse(utcDay(to) + 'T00:00:00.000Z');
  const out: string[] = [];
  for (let t = start; t <= end; t += DAY_MS) out.push(utcDay(t));
  return out;
}

/** The newest UTC day entirely outside the dense window — the newest day safe to archive. */
export function newestArchivableDay(
  now: Date | number = new Date(),
  policy: typeof READING_RETENTION = READING_RETENTION
): string {
  return utcDay(ms(now) - policy.denseWindowDays * DAY_MS);
}
