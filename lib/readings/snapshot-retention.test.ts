import { SNAPSHOT_RETENTION, snapshotSurvivors, snapshotBucket, SNAPSHOT_ESTIMATE_SQL, type Snapshot } from './snapshot-retention';

// view_snapshots has no retention (2026-09-26: 3.39 M rows, 1,009 MB, ~51 K rows/day). This is the
// PROPOSED policy — pure and tested, estimated against production, NOT wired to any delete. Its
// contract is the archive-then-thin one the readings use: nothing leaves Postgres before the day
// is written to R2, read back and matched.
const NOW = new Date('2026-09-26T12:00:00Z');
const s = (video_id: string, snapshot_date: string, days_since_published: number, view_count = 1): Snapshot =>
  ({ video_id, snapshot_date, days_since_published, view_count });

describe('the snapshot retention proposal', () => {
  it('never touches snapshots newer than the protection window', () => {
    expect(SNAPSHOT_RETENTION.protectDays).toBe(90);
    const rows = [s('v', '2026-09-20', 100), s('v', '2026-09-21', 101), s('v', '2026-09-22', 102)];
    expect(snapshotSurvivors(rows, NOW)).toEqual(rows);
  });

  it('keeps every snapshot of a video\'s first 30 days of life, at any snapshot age', () => {
    const rows = Array.from({ length: 30 }, (_, i) => s('v', `2025-07-${String(i + 1).padStart(2, '0')}`, i + 1));
    expect(snapshotSurvivors(rows, NOW)).toHaveLength(30);
  });

  it('keeps the last snapshot per week of age up to a year, then per 30 days', () => {
    expect(snapshotBucket(45)).toBe('w6');
    expect(snapshotBucket(46)).toBe('w6');
    expect(snapshotBucket(400)).toBe('m13');
    const rows = [s('v', '2025-07-01', 43), s('v', '2025-07-02', 44), s('v', '2025-07-03', 45),
                  s('v', '2025-07-10', 52)];
    // 43 (first of the video), 45 (last of week 6), 52 (last of the video) survive; 44 does not.
    expect(snapshotSurvivors(rows, NOW).map((r) => r.days_since_published)).toEqual([43, 45, 52]);
  });

  it('always keeps the first and the last snapshot of every video', () => {
    const rows = [s('v', '2025-01-01', 500), s('v', '2025-01-02', 501), s('v', '2025-01-03', 502)];
    expect(snapshotSurvivors(rows, NOW).map((r) => r.days_since_published)).toEqual([500, 502]);
  });

  it('the estimate is one aggregate row — no snapshot leaves the server', () => {
    expect(SNAPSHOT_ESTIMATE_SQL).toMatch(/count\(\*\) filter \(where keep\)/);
    expect(SNAPSHOT_ESTIMATE_SQL).not.toMatch(/\bdelete\b/i);
  });
});
