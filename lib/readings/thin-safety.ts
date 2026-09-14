// Retry policy for the thinning delete.
//
// A thinning batch and a live RSS insert touch the same rows in obs_cache_dirty / score_dirty /
// series_dirty through the Sep 11 statement triggers. Deleting in primary-key order (sql.ts
// thinBatchSql) and suppressing the delete deltas (THIN_SUPPRESS_DELTAS_SQL) removes the shared
// lock set that produced the 2026-09-14 deadlock; this is the defence behind that, for the
// ordinary contention that remains on the heap and index pages themselves.

/** Postgres SQLSTATEs that mean "someone else had it, try again", and nothing else. */
const RETRYABLE = new Set([
  '40P01', // deadlock_detected
  '55P03', // lock_not_available — our own lock_timeout firing
  '40001', // serialization_failure
]);

export function isRetryableLockError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && RETRYABLE.has(code);
}

/**
 * Backoff between attempts. Bounded on purpose: a batch that cannot get its locks in four tries
 * is contending with something that is not going away, and the right answer is to stop and let
 * the next night's run pick the day up — not to hold a connection on a 512 MB instance.
 */
export function retryDelaysMs(): number[] {
  return [500, 2_000, 8_000, 20_000];
}

/**
 * Slice an ordered list of video ids into whole-video batches.
 *
 * Whole videos, always: thinning half of a video's readings would let the window function pick
 * the "last reading of the hour" out of half the evidence and delete the real one.
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size <= 0) throw new Error(`bad batch size ${size}`);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
