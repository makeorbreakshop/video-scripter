// Should tonight's null-out run, and what did it achieve?
//
// THE DEFECT THIS REPLACES (2026-09-14 .. 09-26). The previous gate was
// `unmoved === 0 ? 'run' : before(05:48) ? 'wait' : 'skip'` — run only once EVERY video in the
// corpus had a video_text row. That queue is fed continuously: daily ingest adds 3-30 K new
// videos, and the job started at 06:00, after its own 05:48 deadline. So it was 'skip' by
// construction, it exited 0 with "Not a failure", and ~2 GB of text stayed stored twice for
// twelve nights while the disk auto-expanded 18 → 27 GB.
//
// A global "backlog == 0" condition on a continuously-fed queue never opens. The safety this
// gate was reaching for is per ROW, and the null-out already has it: a row is cleared only when
// its side copy is proved byte-equal in the same statement (lib/app/video-text-move.ts
// nullWindowSql). Rows the mover has not reached are simply not selected tonight.
//
// What remains here is what genuinely is global: the mirror trigger (it would null video_text
// too) and the per-column reader ratchet (a column with readers must not be cleared).
import { CLEARED_COLUMNS, type TextColumn } from './video-text-move';
import type { JobOutcome } from '../ops/job-outcomes';

export type NullOutPlan =
  | { action: 'run'; columns: readonly TextColumn[] }
  | { action: 'refuse'; reason: string };

export interface NullOutPreflight {
  /** Names of video_text_mirror* triggers still installed on `videos`. */
  mirrorTriggers: readonly string[];
  /** Columns to clear. Defaults to CLEARED_COLUMNS. */
  columns?: readonly TextColumn[];
}

/** The whole decision. Deliberately takes no backlog: see the header. */
export function planNullOut({ mirrorTriggers, columns = CLEARED_COLUMNS }: NullOutPreflight): NullOutPlan {
  if (mirrorTriggers.length) {
    return { action: 'refuse', reason: `the mirror trigger is still installed (${mirrorTriggers.join(', ')}); ` +
      'it would overwrite video_text with the NULLs — apply sql/2026-09-14-retire-video-text-mirror.sql' };
  }
  if (!columns.length) return { action: 'refuse', reason: 'no columns to clear' };
  const blocked = columns.filter((c) => !CLEARED_COLUMNS.includes(c));
  if (blocked.length) {
    return { action: 'refuse', reason: `${blocked.join(', ')} still has direct readers ` +
      '(lib/app/video-text-access.test.ts); clearing it would serve empty text' };
  }
  return { action: 'run', columns };
}

/** One window's result row from nullWindowSql. */
export interface NullWindow {
  nextCursor: string | null;
  scanned: number;
  cleared: number;
  disagree: number;
  unmovedHolding: number;
}

export interface NullPassSummary {
  /** progressed: cleared rows. idle: nothing held text. noop: text held, nothing cleared. */
  status: 'progressed' | 'idle' | 'noop';
  progressed: number;
  /** Rows seen still holding text that this pass could not clear (unmoved + disagreeing). */
  backlog: number;
  scanned: number;
  disagree: number;
  unmovedHolding: number;
  /** True when the pass reached the end of the key space. */
  wrapped: boolean;
  warnings: string[];
}

export function summarizeNullPass(windows: readonly NullWindow[], { wrapped }: { wrapped: boolean }): NullPassSummary {
  const sum = (k: keyof NullWindow) => windows.reduce((s, w) => s + Number(w[k] ?? 0), 0);
  const progressed = sum('cleared');
  const disagree = sum('disagree');
  const unmovedHolding = sum('unmovedHolding');
  const backlog = disagree + unmovedHolding;
  const warnings: string[] = [];
  if (disagree) warnings.push(`${disagree} row(s) disagree with their side copy and were left alone`);
  const status = progressed > 0 ? 'progressed' : backlog > 0 ? 'noop' : 'idle';
  return { status, progressed, backlog, scanned: sum('scanned'), disagree, unmovedHolding, wrapped, warnings };
}

/**
 * The most recent FULL pass (started at '' and reached the end) over the same columns that found nothing held, if it is within
 * `days` and nothing has progressed since. When there is one, tonight's walk would read ~1.2 M
 * wide rows to find nothing, so the job records `idle` and skips it; a weekly full pass still
 * catches a legacy writer that slipped text back in.
 */
export function recentIdleFullPass(
  outcomes: readonly JobOutcome[], columns: readonly string[], now: Date, days: number,
): JobOutcome | undefined {
  const same = (o: JobOutcome) => {
    const cols = (o.meta?.columns as string[] | undefined) ?? [];
    return cols.length === columns.length && cols.every((c) => columns.includes(c));
  };
  // A skip is not evidence of anything; look past it to the pass that justified it.
  const mine = outcomes.filter((o) => o.job === 'null-video-text' && same(o) && !o.meta?.skipped);
  const last = mine.at(-1);
  if (!last || last.status !== 'idle' || last.meta?.fullPass !== true) return undefined;
  if (now.getTime() - new Date(last.at).getTime() > days * 86_400_000) return undefined;
  return last;
}
