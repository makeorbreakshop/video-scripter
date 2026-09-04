// Which readings are real, and which are the counter lying.
//
// View counts are monotone non-decreasing in time, so a reading followed minutes later by a
// much higher one is not a burst — it is a cached number. BPS.space PpwewkOCFuE was ingested
// at 20:27:58 ET carrying 77,993 views; at 20:32:09 the counter said 110,729. The chart
// anchored the whole reconstructed past on that first number, so the launch was drawn scaled
// to a stale count and the measured line then "jumped" 42% in four minutes.
//
// Two things are separated here, because they are two different faults:
//   - `duplicate`: the same count repeated (the counter sat still, or the sampler re-read a
//     cached value). The reading is true, it just carries no new information, so it must not
//     get its own weight in a fit.
//   - `stale`: the count was already wrong when it was taken. It is excluded from anchoring
//     and fitting entirely.

export interface Reading { day: number; views: number }
export interface MarkedReading extends Reading { stale: boolean; duplicate: boolean }

/** A jump this soon after a reading is what makes that reading suspect. */
export const STALE_WINDOW_DAYS = 30 / 1440;
/** ...and it has to be a jump: 10% is far more than the counter drifts in half an hour. */
export const STALE_JUMP = 0.1;
/**
 * A jump alone is not enough, because a real launch hour can genuinely add 10% in fifteen
 * minutes. What convicts a reading is that the growth rate its own step implies is many times
 * the rate the video is actually running at either side of it.
 */
export const STALE_RATE_RATIO = 4;
/** "Either side of it": the steps whose midpoints sit within this of the candidate's. */
export const LOCAL_WINDOW_DAYS = 2 / 24;

const clean = (rs: Reading[]): Reading[] =>
  rs
    .filter((r) => r && Number.isFinite(r.day) && r.day >= 0 && Number.isFinite(r.views) && r.views > 0)
    .sort((a, b) => a.day - b.day);

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const a = [...xs].sort((u, v) => u - v);
  const i = (a.length - 1) / 2;
  return a.length % 2 ? a[i] : (a[i - 0.5] + a[i + 0.5]) / 2;
};

/**
 * Mark each reading. Duplicates are collapsed FIRST — the second 110,729 fifteen minutes after
 * the first is the same fact, and leaving it in would make the first look like the start of a
 * 30%-in-15-minutes jump and convict it of being stale.
 */
export function markObservations(readings: Reading[]): MarkedReading[] {
  const rs = clean(readings);
  const out: MarkedReading[] = rs.map((r) => ({ ...r, stale: false, duplicate: false }));
  for (let i = 1; i < out.length; i++) if (out[i].views === out[i - 1].views) out[i].duplicate = true;

  // The distinct readings, in order, and the log growth rate of each step between them.
  const idx = out.map((r, i) => i).filter((i) => !out[i].duplicate);
  const rate: number[] = []; // rate[k] = step from idx[k] to idx[k+1], per day, in log views
  const mid: number[] = [];
  for (let k = 0; k + 1 < idx.length; k++) {
    const a = out[idx[k]], b = out[idx[k + 1]];
    const dt = b.day - a.day;
    rate.push(dt > 0 ? Math.log(b.views / a.views) / dt : Infinity);
    mid.push((a.day + b.day) / 2);
  }

  for (let k = 0; k + 1 < idx.length; k++) {
    const a = out[idx[k]];
    // (1) something within the window says this reading was already out of date
    const jumped = idx.slice(k + 1).some((j) => out[j].day - a.day <= STALE_WINDOW_DAYS && out[j].views > a.views * (1 + STALE_JUMP));
    if (!jumped) continue;
    // (2) and the step out of it claims a rate the local record contradicts
    const local = rate.filter((r, m) => m !== k && r > 0 && Number.isFinite(r) && Math.abs(mid[m] - mid[k]) <= LOCAL_WINDOW_DAYS);
    const ref = median(local);
    if (ref == null || !(ref > 0)) continue; // nothing to compare against: do not convict
    if (rate[k] >= ref * STALE_RATE_RATIO) out[idx[k]].stale = true;
  }
  return out;
}

/** The readings a fit or an anchor may use: real, and each counting once. */
export function fittablePoints(readings: Reading[]): Reading[] {
  return markObservations(readings)
    .filter((r) => !r.stale && !r.duplicate)
    .map(({ day, views }) => ({ day, views }));
}

// ------------------------------------------------ where a snapshot goes on the chart ----

/**
 * `view_snapshots` carries a DATE, not a time: `snapshot_date` is a calendar day, and the page
 * has always drawn a snapshot at noon UTC on that day (8 AM ET) because noon is the least wrong
 * single guess for an unknown time. The row also carries `created_at`, which is when the tracker
 * actually wrote it — usually the truth, and sometimes not: a backfill import writes today's
 * timestamp onto a row for a day months ago.
 *
 * Measured over the corpus on 2026-09-04: for 87% of rows `created_at` sits within six hours of
 * the noon anchor, and the tail runs out to +228 hours, which is exactly the backfill case. So:
 * within a day of the anchor, `created_at` is a better time than a guess and is used; beyond it,
 * it is an import time and the anchor stands.
 *
 * THE CHART ONLY. The scorer keeps reading snapshot_date as it always has — a candidate change
 * to it was benchmarked and rejected on 2026-09-04 — and this function is not imported there.
 *
 * The visible fix: MythBusters aiadrt1mKEc's Sep 4 snapshot was created 2026-09-03 20:17 ET and
 * was being drawn at 8 AM ET on the 4th, so the measured line ran twelve hours into the future.
 */
export const SNAPSHOT_TRUST_MS = 24 * 3_600_000;
/** Noon UTC on the snapshot's calendar day: the anchor, and the fallback. */
export const SNAPSHOT_ANCHOR_MS = 12 * 3_600_000;

export function snapshotAnchor(snapshotDate: string | Date): number {
  const d = new Date(snapshotDate);
  const t = d.getTime();
  if (!Number.isFinite(t)) return NaN;
  // A bare 'YYYY-MM-DD' parses as UTC midnight; a timestamptz already carries its own time, and
  // pg hands this column over as a date, so the day is what is used either way.
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + SNAPSHOT_ANCHOR_MS;
}

/**
 * When to draw a snapshot, as epoch ms. `createdAt` when it is within a day of the anchor,
 * otherwise the anchor. Exactly a day counts as within — the boundary belongs to the reading.
 */
export function snapshotTimeMs(snapshotDate: string | Date, createdAt: string | Date | null | undefined): number {
  const anchor = snapshotAnchor(snapshotDate);
  if (!Number.isFinite(anchor)) return anchor;
  if (createdAt == null) return anchor;
  const c = new Date(createdAt).getTime();
  if (!Number.isFinite(c)) return anchor;
  return Math.abs(c - anchor) <= SNAPSHOT_TRUST_MS ? c : anchor;
}

/** The same answer as an ISO string, which is what the series builder is fed. */
export function snapshotTimeIso(snapshotDate: string | Date, createdAt: string | Date | null | undefined): string {
  const t = snapshotTimeMs(snapshotDate, createdAt);
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date(snapshotDate).toISOString();
}
