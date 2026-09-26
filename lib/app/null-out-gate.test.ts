import { planNullOut, summarizeNullPass, recentIdleFullPass, type NullWindow } from './null-out-gate';
import { CLEARED_COLUMNS } from './video-text-move';

// THE DEFECT THIS FILE PINS (2026-09-14 .. 09-26). The 06:00 job asked "is the whole corpus
// moved?" and ran only on an exact zero. Ingest adds 3-30 K unmoved videos a day, and the job
// started at 06:00 against a 05:48 deadline, so the answer was "skip" on every one of these
// nights — the real numbers from logs/null-video-text-launchd.log. Not one row was ever cleared,
// and every night logged "Not a failure."
const REAL_NIGHTS_UNMOVED = [10, 5_487, 10_312, 2, 3_386, 3_298, 2_812, 10_516, 16_972, 25_276, 38, 4_866];

describe('the null-out plan never waits for a continuously-fed queue to empty', () => {
  it.each(REAL_NIGHTS_UNMOVED)('runs on a night with %i videos not yet moved', (unmoved) => {
    // The plan takes no backlog at all. Rows the mover has not reached are simply not selected
    // by the per-row verification this night; they are cleared on a later one.
    const plan = planNullOut({ mirrorTriggers: [], columns: ['llm_summary'] });
    expect(plan.action).toBe('run');
    void unmoved;
  });

  it('has no input through which a corpus-wide count could gate it again', () => {
    // A structural assertion, because the regression would be one innocent-looking parameter.
    expect(planNullOut.length).toBe(1);
    const plan = planNullOut({ mirrorTriggers: [], columns: CLEARED_COLUMNS } as any);
    expect(Object.keys(plan).sort()).toEqual(['action', 'columns']);
  });
});

describe('the refusals that remain are per-row or per-column, never global backlog', () => {
  it('refuses while the mirror trigger exists — it would null video_text too', () => {
    const plan = planNullOut({ mirrorTriggers: ['video_text_mirror_upd'], columns: ['llm_summary'] });
    expect(plan).toEqual({ action: 'refuse', reason: expect.stringMatching(/mirror trigger/) });
  });

  it('refuses a column that still has direct readers (not in CLEARED_COLUMNS)', () => {
    const plan = planNullOut({ mirrorTriggers: [], columns: ['llm_summary', 'description'] as any });
    expect(plan.action).toBe('refuse');
    if (plan.action === 'refuse') expect(plan.reason).toMatch(/description/);
  });

  it('refuses an empty column list rather than walking the table for nothing', () => {
    expect(planNullOut({ mirrorTriggers: [], columns: [] }).action).toBe('refuse');
  });

  it('defaults to exactly the cleared columns', () => {
    expect(planNullOut({ mirrorTriggers: [] })).toEqual({ action: 'run', columns: CLEARED_COLUMNS });
  });
});

describe('the outcome of one pass', () => {
  const w = (o: Partial<NullWindow>): NullWindow =>
    ({ nextCursor: 'x', scanned: 5000, cleared: 0, disagree: 0, unmovedHolding: 0, ...o });

  it('reports progress when it cleared anything', () => {
    const s = summarizeNullPass([w({ cleared: 120 }), w({ cleared: 3 })], { wrapped: false });
    expect(s).toMatchObject({ status: 'progressed', progressed: 123, backlog: 0 });
  });

  it('calls a pass that found nothing to clear and nothing blocked "idle", not a stand-down', () => {
    expect(summarizeNullPass([w({})], { wrapped: true })).toMatchObject({ status: 'idle', progressed: 0, backlog: 0 });
  });

  it('flags a pass that cleared nothing while rows still hold text as a no-op WITH backlog', () => {
    // This is the exact shape of the 12 silent nights: work exists, none was done. The job
    // outcome ledger (lib/ops/job-outcomes.ts) alerts after N of these in a row.
    const s = summarizeNullPass([w({ unmovedHolding: 40, disagree: 2 })], { wrapped: true });
    expect(s).toMatchObject({ status: 'noop', progressed: 0, backlog: 42 });
  });

  it('keeps disagreements visible — they are never cleared and must never be silent', () => {
    const s = summarizeNullPass([w({ cleared: 10, disagree: 3 })], { wrapped: false });
    expect(s.disagree).toBe(3);
    expect(s.warnings.join(' ')).toMatch(/3 row\(s\) disagree/);
  });
});

describe('skipping the walk when a recent full pass found nothing to do', () => {
  // Once a column is cleared and every writer has stopped writing it, a nightly full walk reads
  // ~1.2 M wide rows to find nothing. A full pass that came back idle within the last week is
  // proof enough; the weekly pass still catches a legacy writer that slipped one in.
  const now = new Date('2026-10-05T10:00:00Z');
  const idle = (at: string, columns = ['llm_summary']) => ({ job: 'null-video-text', at, status: 'idle' as const,
    progressed: 0, backlog: 0, meta: { columns, fullPass: true } });

  it('finds an idle full pass for the same columns inside the window', () => {
    expect(recentIdleFullPass([idle('2026-10-01T10:00:00Z')], ['llm_summary'], now, 7)).toBeTruthy();
  });

  it('ignores one older than the window', () => {
    expect(recentIdleFullPass([idle('2026-09-27T10:00:00Z')], ['llm_summary'], now, 7)).toBeUndefined();
  });

  it('ignores one for different columns — a newly cleared column always gets its first walk', () => {
    expect(recentIdleFullPass([idle('2026-10-04T10:00:00Z')], ['llm_summary', 'description'], now, 7)).toBeUndefined();
  });

  it('ignores it if anything progressed since (the pass that cleared rows proves nothing about now)', () => {
    const later = { ...idle('2026-10-03T10:00:00Z'), status: 'progressed' as const, progressed: 5, meta: { columns: ['llm_summary'], fullPass: false } };
    expect(recentIdleFullPass([idle('2026-10-01T10:00:00Z'), later], ['llm_summary'], now, 7)).toBeUndefined();
  });

  it('ignores a partial (budget-stopped) idle pass', () => {
    const partial = { ...idle('2026-10-04T10:00:00Z'), meta: { columns: ['llm_summary'], fullPass: false } };
    expect(recentIdleFullPass([partial], ['llm_summary'], now, 7)).toBeUndefined();
  });

  it('looks past its own skip records, so the skip lasts the whole window rather than alternating', () => {
    const skip = { ...idle('2026-10-04T10:00:00Z'), meta: { columns: ['llm_summary'], fullPass: false, skipped: true } };
    expect(recentIdleFullPass([idle('2026-10-01T10:00:00Z'), skip], ['llm_summary'], now, 7)).toBeTruthy();
  });
});
