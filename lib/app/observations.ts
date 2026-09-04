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
