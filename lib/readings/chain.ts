// The control flow of the nightly archive → thin chain.
//
// Pure decisions, no I/O: scripts/archive-readings.ts and scripts/thin-readings.ts own the pool,
// this module owns "should we, and if not why not". lib/readings/chain.test.ts is the
// specification, and every case in it is a night that actually happened.
//
// Three defects this encodes against:
//
//  1. 2026-09-08..13, SIX NIGHTS WITH NOTHING DELETED. archive-readings exited 1 when the shrink
//     guard REFUSED one day, and the plist ran `archive && thin`, so thinning never ran at all —
//     for sixteen perfectly verified days. A refusal is the guard doing its job. Only a genuine
//     verification failure is a failure. See archiveExitCode().
//  2. 2026-09-14, 737 MB OF R2 WRITES TO PRODUCE IDENTICAL OBJECTS. Every night re-archived all
//     17 verified days from scratch. A verified day whose Postgres row count has not moved is
//     already in R2, byte for byte. See decideArchive().
//  3. 2026-09-14, A 3.5-MINUTE NO-OP. `THINNED rss 2026-09-03 (hourly): 286,346 → 286,346 (−0)`
//     — the day had already been thinned to the hourly tier six days earlier, and the run
//     re-walked every video in it to delete nothing. The ledger now records the tier a day was
//     thinned to and the row count it was left at. See decideThin().
import type { ReadingSource } from './retention';

/** The thinning tier a day was last reduced to. Mirrors sql.ts `Bucket`. */
export type ThinnedTier = 'hour' | 'day';

/** One row of readings_archive_days, including the thinning state added 2026-09-14. */
export interface LedgerRow {
  day: string;
  source: ReadingSource | 'history';
  rows: number;
  bytes: number;
  checksum: string;
  object_key: string;
  verified_at: Date | string | null;
  /** The tier this day was last thinned to, or null if it has never been thinned. */
  thinned_tier: ThinnedTier | null;
  /** The Postgres row count this day was left at by that thinning pass. */
  thinned_rows: number | null;
}

function rowFor(
  day: string, source: ReadingSource | 'history', ledger: readonly LedgerRow[]
): LedgerRow | undefined {
  return ledger.find((d) => d.day === day && d.source === source);
}

function isVerified(row: LedgerRow | undefined): row is LedgerRow {
  return !!row && !!row.verified_at &&
    typeof row.checksum === 'string' && row.checksum.length === 64;
}

// ---- archive ---------------------------------------------------------------------------

export type ArchiveDecision =
  | { action: 'write'; reason: 'new' | 'unverified' | 'grew' | 'shrink-allowed' }
  | { action: 'skip'; reason: 'unchanged' }
  | { action: 'refuse'; reason: 'shrink'; archiveRows: number; pgRows: number };

/**
 * Whether tonight should write this (day, source) to R2 again.
 *
 * The row count is the whole signal, and it is enough:
 *
 *   - not in the ledger, or in it unverified → write. Nothing trustworthy is out there.
 *   - verified and Postgres has the same count → SKIP. The object is already correct, and
 *     rewriting it costs a full read of the day and a full PUT for a byte-identical result.
 *   - verified and Postgres has MORE rows → write. Readings arrived late; the archive is behind.
 *   - verified and Postgres has FEWER rows → REFUSE. This day has been thinned, so Postgres now
 *     holds the hourly survivors and re-archiving would overwrite a complete archive with a
 *     partial one — deleting the difference from the only store that still has it. This happened
 *     once for real, on rss 2026-09-03 (2026-09-08): 1.9 M rows in the archive became 286 k.
 */
export function decideArchive(
  day: string,
  source: ReadingSource | 'history',
  pgRows: number,
  ledger: readonly LedgerRow[],
  opts: { allowShrink?: boolean } = {}
): ArchiveDecision {
  const row = rowFor(day, source, ledger);
  if (!row) return { action: 'write', reason: 'new' };
  if (!isVerified(row)) return { action: 'write', reason: 'unverified' };
  const archiveRows = Number(row.rows);
  if (pgRows === archiveRows) return { action: 'skip', reason: 'unchanged' };
  if (pgRows > archiveRows) return { action: 'write', reason: 'grew' };
  if (opts.allowShrink) return { action: 'write', reason: 'shrink-allowed' };
  return { action: 'refuse', reason: 'shrink', archiveRows, pgRows };
}

export interface ArchiveCounts {
  verified: number;
  failed: number;
  refused: number;
  skipped: number;
}

/**
 * THE SIX LOST NIGHTS, in one function.
 *
 * A REFUSED day is the shrink guard working correctly — the archive is intact and the day is
 * simply not rewritten. A SKIPPED day is already archived. Neither is a reason to abandon the
 * run, and under the plist's old `archive && thin` a non-zero exit meant six nights in which
 * sixteen verified days were never thinned and rss_samples grew to 9.4 M stale rows.
 *
 * Only a day that was written and then failed to read back is a failure.
 */
export function archiveExitCode(counts: ArchiveCounts): number {
  return counts.failed > 0 ? 1 : 0;
}

export function summarizeArchive(counts: ArchiveCounts): string {
  return `${counts.verified} verified, ${counts.failed} failed, ` +
         `${counts.refused} refused, ${counts.skipped} skipped`;
}

// ---- thin ------------------------------------------------------------------------------

export type ThinDecision =
  | { action: 'thin' }
  | { action: 'skip'; reason: 'unverified' | 'already-thinned' | 'empty' };

/**
 * Whether this (day, source) is worth walking tonight.
 *
 * THE RULE first: nothing is deleted from a day the ledger does not record as written to R2,
 * read back and matched. Disk pressure is preferable to data loss.
 *
 * Then cost. A day is thinned twice in its life — once when it leaves the dense window into the
 * hourly tier, once when it crosses into the daily tier — and every other night's walk over it
 * deletes nothing. Recording `(thinned_tier, thinned_rows)` makes that walk unnecessary: if the
 * day was already reduced to this tier and its row count has not moved since, there is provably
 * nothing to delete. `rss 2026-09-03` cost 3.5 minutes of index scans to prove that the hard way.
 *
 * A row count that has moved means readings arrived after the last pass, so the day is walked
 * again; a change of tier always re-walks.
 */
export function decideThin(
  day: string,
  source: ReadingSource | 'history',
  tier: ThinnedTier,
  pgRows: number,
  ledger: readonly LedgerRow[]
): ThinDecision {
  const row = rowFor(day, source, ledger);
  if (!isVerified(row)) return { action: 'skip', reason: 'unverified' };
  if (pgRows === 0) return { action: 'skip', reason: 'empty' };
  if (row.thinned_tier === tier && Number(row.thinned_rows) === pgRows) {
    return { action: 'skip', reason: 'already-thinned' };
  }
  return { action: 'thin' };
}
