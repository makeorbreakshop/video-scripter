// video_score_history retention: 14 days in Postgres, everything older lives only in R2.
//
// 2026-09-14 state: 1,369 MB, 3,252,511 rows, oldest row 2026-09-02 11:57 UTC, and NOTHING has
// ever been deleted. That is not a bug — the cutoff is `now - 14 days` = 2026-08-31, the oldest
// row is two days NEWER than the cutoff, so the correct behaviour is to delete nothing. This
// file pins the arithmetic so that when the first day does become eligible (2026-09-16, when
// 2026-09-02 turns 14 days old) it is deleted, and so that it is deleted safely.
import { READING_RETENTION, utcDay, dayRange, isThinnable, type ArchivedDay } from './retention';
import { HISTORY_DELETE_BATCH_SQL, HISTORY_COUNT_DAY_SQL, HISTORY_SELECT_DAY_SQL } from './sql';

/** The cutoff the scripts compute: the newest day that is already outside the window. */
const historyCutoff = (now: Date) =>
  utcDay(now.getTime() - READING_RETENTION.historyDays * 86_400_000);

/** The days a run would consider, given the oldest row present. */
const eligibleDays = (oldest: string, now: Date) =>
  dayRange(oldest, historyCutoff(now)).filter((d) => d <= historyCutoff(now));

describe('the 14-day cutoff', () => {
  it('is 14 days, not 7 and not 30', () => {
    expect(READING_RETENTION.historyDays).toBe(14);
  });

  it('on 2026-09-14 the cutoff is 2026-08-31', () => {
    expect(historyCutoff(new Date('2026-09-14T12:00:00Z'))).toBe('2026-08-31');
  });

  // THE THING TO VERIFY: nothing has been deleted, and that is correct.
  it('deletes nothing today, because the oldest row (2026-09-02) is newer than the cutoff', () => {
    expect(eligibleDays('2026-09-02', new Date('2026-09-14T12:00:00Z'))).toEqual([]);
  });

  it('deletes 2026-09-02 on 2026-09-16, the day it turns 14 days old', () => {
    expect(historyCutoff(new Date('2026-09-16T12:00:00Z'))).toBe('2026-09-02');
    expect(eligibleDays('2026-09-02', new Date('2026-09-16T12:00:00Z'))).toEqual(['2026-09-02']);
  });

  it('never proposes a day inside the window', () => {
    const now = new Date('2026-09-30T00:00:00Z');
    const cutoff = historyCutoff(now); // 2026-09-16
    for (const d of eligibleDays('2026-09-02', now)) expect(d <= cutoff).toBe(true);
  });

  it('walks forward from the oldest row, one day at a time, oldest first', () => {
    const days = eligibleDays('2026-09-02', new Date('2026-09-20T00:00:00Z'));
    expect(days[0]).toBe('2026-09-02');
    expect(days).toEqual([...days].sort());
    for (let i = 1; i < days.length; i++) {
      expect(Date.parse(days[i]) - Date.parse(days[i - 1])).toBe(86_400_000);
    }
  });

  it('is a no-op when the table is empty (no oldest row, no range)', () => {
    expect(eligibleDays('2026-09-20', new Date('2026-09-14T12:00:00Z'))).toEqual([]);
  });
});

describe('the delete itself', () => {
  it('is batched — it never deletes a whole day in one statement', () => {
    expect(HISTORY_DELETE_BATCH_SQL).toMatch(/limit \$3/);
    expect(READING_RETENTION.batchSize).toBeLessThanOrEqual(20_000);
  });

  it('is keyset on the bigint id, not OFFSET', () => {
    expect(HISTORY_DELETE_BATCH_SQL).toMatch(/id > \$2::bigint/);
    expect(HISTORY_DELETE_BATCH_SQL).toMatch(/order by id/);
    expect(HISTORY_DELETE_BATCH_SQL).not.toMatch(/\boffset\b/i);
  });

  it('is bounded by the day on an indexed column (idx_vsh_scored_at)', () => {
    // Both the count and the delete bound scored_at with a half-open range on the raw column,
    // so the index is usable — no date_trunc(), no ::date cast on the column side.
    for (const sql of [HISTORY_DELETE_BATCH_SQL, HISTORY_COUNT_DAY_SQL, HISTORY_SELECT_DAY_SQL]) {
      expect(sql).toMatch(/scored_at >= \$1::date and scored_at < \(\$1::date \+ interval '1 day'\)/);
      expect(sql).not.toMatch(/date_trunc\([^)]*scored_at/);
      expect(sql).not.toMatch(/scored_at::date\s*=/);
    }
  });

  it('returns the ids it deleted, so the cursor advances on fact', () => {
    expect(HISTORY_DELETE_BATCH_SQL).toMatch(/returning h\.id/);
  });
});

describe('the archive gate applies to history exactly as it does to readings', () => {
  const led = (o: Partial<ArchivedDay>): ArchivedDay => ({
    day: '2026-09-02', source: 'history', rows: 1, bytes: 1,
    checksum: 'a'.repeat(64), verified_at: new Date(), ...o,
  } as ArchivedDay);

  it('refuses a history day that is not in the ledger', () => {
    expect(isThinnable('2026-09-02', 'history', [])).toBe(false);
  });

  it('refuses a history day that was written but never verified', () => {
    expect(isThinnable('2026-09-02', 'history', [led({ verified_at: null })])).toBe(false);
  });

  it('allows a history day written, read back and matched', () => {
    expect(isThinnable('2026-09-02', 'history', [led({})])).toBe(true);
  });

  it('does not confuse a verified rss day with a history day of the same date', () => {
    expect(isThinnable('2026-09-02', 'history', [led({ source: 'rss' as any })])).toBe(false);
  });

  it('allows a verified EMPTY day — there is nothing to lose', () => {
    expect(isThinnable('2026-09-01', 'history', [led({ day: '2026-09-01', rows: 0 })])).toBe(true);
  });
});
