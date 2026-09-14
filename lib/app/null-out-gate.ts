// Should tonight's null-out run, wait, or stand down?
//
// The null-out is scheduled at 06:00 ET; scripts/move-video-text.ts starts at 05:30 and has
// 1,097,222 rows left. At the ~1,000 rows/s the dry run suggests that is about eighteen
// minutes, finishing around 05:48 — so the arithmetic fits, with twelve minutes to spare.
//
// Twelve minutes is not a margin, it is a coincidence. The mover stops itself whenever anything
// has been running in Postgres for over two minutes, and the 04:15 fit and 05:05 packaging
// counts are both capable of overrunning into it. So the null-out does not trust the clock: it
// asks whether the move has actually finished, waits for it up to a deadline, and stands down
// cleanly if it has not.
//
// Standing down is the SAFE outcome and must not look like a failure. The null-out is
// irreversible; not running it tonight costs one night of disk. Running it against a half-moved
// corpus means running it again anyway, on a table that is now partly cleared.

export type Decision = 'run' | 'wait' | 'skip';

/** Minutes past midnight, in the given IANA zone, for an instant. */
export function minutesOfDay(now: Date, timeZone = 'America/New_York'): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  // Intl renders midnight as hour 24 in some ICU versions.
  return (get('hour') % 24) * 60 + get('minute');
}

export interface GateInput {
  now: Date;
  /** Videos with no video_text row yet. Zero means the move has covered the corpus. */
  unmoved: number;
  /** Give up waiting at this time, ET. Default 05:48 — the mover's expected finish. */
  deadline?: string;
}

/** The whole decision, as one pure function, so the schedule is testable without a clock. */
export function nullOutDecision({ now, unmoved, deadline = '05:48' }: GateInput): Decision {
  const [h, m] = deadline.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) throw new Error(`bad deadline ${deadline}`);
  if (unmoved === 0) return 'run';
  return minutesOfDay(now) < h * 60 + m ? 'wait' : 'skip';
}
