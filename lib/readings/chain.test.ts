// The specification for the archive→thin chain's control flow (lib/readings/chain.ts).
//
// Every case here is a night that actually happened between 2026-09-08 and 2026-09-14:
// six nights where nothing was deleted because a REFUSED shrink on one day was counted as a
// failure and `archive && thin` never reached the thin step; and one morning where re-archiving
// 17 already-verified days wrote 737 MB to R2 to produce byte-identical objects.
import {
  decideArchive, decideThin, archiveExitCode, summarizeArchive,
  type LedgerRow,
} from './chain';

const led = (o: Partial<LedgerRow> & Pick<LedgerRow, 'day' | 'source'>): LedgerRow => ({
  rows: 0, bytes: 0, checksum: 'x'.repeat(64), object_key: 'k',
  verified_at: new Date('2026-09-14T02:30:00Z'), thinned_tier: null, thinned_rows: null, ...o,
});

describe('decideArchive', () => {
  it('writes a day that is not in the ledger at all', () => {
    expect(decideArchive('2026-09-11', 'rss', 500_000, [])).toEqual({ action: 'write', reason: 'new' });
  });

  it('writes a day whose ledger row was never verified', () => {
    const ledger = [led({ day: '2026-09-11', source: 'rss', rows: 500_000, verified_at: null })];
    expect(decideArchive('2026-09-11', 'rss', 500_000, ledger))
      .toEqual({ action: 'write', reason: 'unverified' });
  });

  // The 737 MB of pointless R2 writes. Every night re-archived all 17 verified days.
  it('SKIPS a verified day whose Postgres row count has not changed', () => {
    const ledger = [led({ day: '2026-09-10', source: 'rss', rows: 732_060 })];
    expect(decideArchive('2026-09-10', 'rss', 732_060, ledger))
      .toEqual({ action: 'skip', reason: 'unchanged' });
  });

  it('rewrites a verified day that gained rows in Postgres (late-arriving readings)', () => {
    const ledger = [led({ day: '2026-09-10', source: 'rss', rows: 732_060 })];
    expect(decideArchive('2026-09-10', 'rss', 732_100, ledger))
      .toEqual({ action: 'write', reason: 'grew' });
  });

  // The 2026-09-08 incident: a re-archive of an already-thinned day overwrote 1.9 M rows with
  // 286 k. The guard must fire — and must be reported as a guard, not as a failure.
  it('REFUSES a verified day whose Postgres row count shrank', () => {
    const ledger = [led({ day: '2026-09-03', source: 'rss', rows: 1_900_000 })];
    expect(decideArchive('2026-09-03', 'rss', 286_346, ledger)).toEqual({
      action: 'refuse', reason: 'shrink', archiveRows: 1_900_000, pgRows: 286_346,
    });
  });

  it('--allow-shrink overrides the refusal', () => {
    const ledger = [led({ day: '2026-09-03', source: 'rss', rows: 1_900_000 })];
    expect(decideArchive('2026-09-03', 'rss', 286_346, ledger, { allowShrink: true }))
      .toEqual({ action: 'write', reason: 'shrink-allowed' });
  });

  it('keys on (day, source): another source at the same day is not this day', () => {
    const ledger = [led({ day: '2026-09-10', source: 'api', rows: 204_993 })];
    expect(decideArchive('2026-09-10', 'rss', 732_060, ledger))
      .toEqual({ action: 'write', reason: 'new' });
  });
});

describe('archive exit code', () => {
  // THE SIX LOST NIGHTS. `archive && thin` skipped thinning every night because exit 1.
  it('is 0 when the only non-verified days are refused', () => {
    expect(archiveExitCode({ verified: 16, failed: 0, refused: 1, skipped: 0 })).toBe(0);
  });

  it('is 0 when every day was skipped as unchanged', () => {
    expect(archiveExitCode({ verified: 0, failed: 0, refused: 0, skipped: 17 })).toBe(0);
  });

  it('is 1 only when a day genuinely failed verification', () => {
    expect(archiveExitCode({ verified: 16, failed: 1, refused: 1, skipped: 0 })).toBe(1);
  });

  it('reports refused separately from failed', () => {
    const s = summarizeArchive({ verified: 16, failed: 0, refused: 1, skipped: 3 });
    expect(s).toContain('1 refused');
    expect(s).toContain('0 failed');
    expect(s).toContain('3 skipped');
  });
});

describe('decideThin', () => {
  const day = '2026-09-03', source = 'rss' as const;

  it('refuses a day with no verified archive', () => {
    expect(decideThin(day, source, 'hour', 286_346, [])).toEqual({ action: 'skip', reason: 'unverified' });
  });

  it('thins a verified day that has never been thinned', () => {
    const ledger = [led({ day, source, rows: 1_900_000 })];
    expect(decideThin(day, source, 'hour', 1_900_000, ledger)).toEqual({ action: 'thin' });
  });

  // The 3.5-minute no-op: `rss 2026-09-03: 286,346 → 286,346 (−0)`.
  it('SKIPS a day already thinned to this tier whose row count has not moved', () => {
    const ledger = [led({ day, source, rows: 1_900_000, thinned_tier: 'hour', thinned_rows: 286_346 })];
    expect(decideThin(day, source, 'hour', 286_346, ledger))
      .toEqual({ action: 'skip', reason: 'already-thinned' });
  });

  it('re-thins when the day crosses from the hourly tier into the daily tier', () => {
    const ledger = [led({ day, source, rows: 1_900_000, thinned_tier: 'hour', thinned_rows: 286_346 })];
    expect(decideThin(day, source, 'day', 286_346, ledger)).toEqual({ action: 'thin' });
  });

  it('re-thins when rows arrived after the last thinning pass', () => {
    const ledger = [led({ day, source, rows: 1_900_000, thinned_tier: 'hour', thinned_rows: 286_346 })];
    expect(decideThin(day, source, 'hour', 286_500, ledger)).toEqual({ action: 'thin' });
  });

  it('skips an empty day without work', () => {
    const ledger = [led({ day, source, rows: 0 })];
    expect(decideThin(day, source, 'hour', 0, ledger)).toEqual({ action: 'skip', reason: 'empty' });
  });
});
