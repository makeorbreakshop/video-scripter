import { shortsUnverifiedStatus, SHORTS_UNVERIFIED_WARN, SHORTS_UNVERIFIED_FAIL,
  rssSamplesPerDayStatus, rowsPerDayStatus, RSS_SAMPLES_PER_DAY_WARN, ROWS_PER_DAY_SQL } from './health-checks';

describe('shortsUnverifiedStatus', () => {
  it('is ok while the verifier is keeping up', () => {
    expect(shortsUnverifiedStatus(0)).toBe('ok');
    expect(shortsUnverifiedStatus(1)).toBe('ok');
    expect(shortsUnverifiedStatus(SHORTS_UNVERIFIED_WARN)).toBe('ok'); // 50, boundary is exclusive
  });

  it('warns just past the warn threshold', () => {
    expect(shortsUnverifiedStatus(SHORTS_UNVERIFIED_WARN + 1)).toBe('warn');
    expect(shortsUnverifiedStatus(SHORTS_UNVERIFIED_FAIL)).toBe('warn'); // 500, boundary is exclusive
  });

  it('fails once the backlog is large enough to move baselines', () => {
    expect(shortsUnverifiedStatus(SHORTS_UNVERIFIED_FAIL + 1)).toBe('fail');
    expect(shortsUnverifiedStatus(64_000)).toBe('fail');
  });

  it('has thresholds in the documented order', () => {
    expect(SHORTS_UNVERIFIED_WARN).toBeLessThan(SHORTS_UNVERIFIED_FAIL);
  });
});

describe('rows/day per measurement table', () => {
  it('warns only once rss_samples is writing more than half a million rows a day', () => {
    // Pre-dedupe reality on 2026-09-03: 441,505 rows in one day (~200 MB). That is the
    // regression this threshold catches, not the steady state after shouldStoreSample.
    expect(rssSamplesPerDayStatus(0)).toBe('ok');
    expect(rssSamplesPerDayStatus(441_505)).toBe('ok');
    expect(rssSamplesPerDayStatus(RSS_SAMPLES_PER_DAY_WARN)).toBe('ok');
    expect(rssSamplesPerDayStatus(RSS_SAMPLES_PER_DAY_WARN + 1)).toBe('warn');
    expect(RSS_SAMPLES_PER_DAY_WARN).toBe(500_000);
  });

  it('treats a measurement table that wrote nothing today as a stalled job', () => {
    expect(rowsPerDayStatus(0)).toBe('warn');
    expect(rowsPerDayStatus(1)).toBe('ok');
    expect(rowsPerDayStatus(120_000)).toBe('ok');
  });

  it('counts today for all three tables on their own timestamp columns', () => {
    for (const t of ['view_samples', 'view_snapshots', 'rss_samples']) {
      expect(ROWS_PER_DAY_SQL).toContain(t);
    }
    expect(ROWS_PER_DAY_SQL).toContain('sampled_at >= current_date');
    expect(ROWS_PER_DAY_SQL).toContain('snapshot_date = current_date');
    expect(ROWS_PER_DAY_SQL).toContain('at >= current_date');
  });
});
