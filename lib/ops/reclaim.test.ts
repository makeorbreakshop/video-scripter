import { planReclaim, repackCommand, VACUUM_FULL_SQL } from './reclaim';

const MB = 1024 * 1024;
const base = {
  table: 'video_score_history', totalBytes: 1392 * MB, heapBytes: 1280 * MB, toastBytes: 0,
  indexBytes: 112 * MB, liveBytes: 94 * MB, diskAvailBytes: 11_000 * MB, hasPrimaryKey: true, repackAvailable: true,
};

describe('planning a one-time reclaim', () => {
  it('prefers pg_repack (online) when the table has a primary key and the client is available', () => {
    const p = planReclaim(base);
    expect(p.method).toBe('pg_repack');
    expect(p.reclaimMb).toBeGreaterThan(1200);
    expect(p.lockSeconds.max).toBeLessThan(30); // brief ACCESS EXCLUSIVE at start and swap only
  });

  it('falls back to VACUUM FULL, with the whole rewrite as the lock window', () => {
    const p = planReclaim({ ...base, repackAvailable: false });
    expect(p.method).toBe('vacuum_full');
    expect(p.lockSeconds.max).toBeGreaterThan(p.lockSeconds.min);
    expect(p.notes.join(' ')).toMatch(/ACCESS EXCLUSIVE for the whole rewrite/);
  });

  it('refuses without room for the second copy (live data + rebuilt indexes, twice over for safety)', () => {
    const p = planReclaim({ ...base, diskAvailBytes: 200 * MB });
    expect(p.method).toBe('refuse');
    expect(p.notes.join(' ')).toMatch(/free disk/);
  });

  it('refuses a big rewrite without an explicit approval — videos is Brandon\'s call', () => {
    const p = planReclaim({ ...base, table: 'videos', totalBytes: 4152 * MB, heapBytes: 1782 * MB,
      toastBytes: 920 * MB, indexBytes: 1449 * MB, liveBytes: 1476 * MB });
    expect(p.method).toBe('refuse');
    expect(p.notes.join(' ')).toMatch(/--approved/);
    // …but still says what it WOULD cost, so the approval is an informed one.
    expect(p.lockSeconds.max).toBeGreaterThan(0);
    expect(p.reclaimMb).toBeGreaterThan(0);
  });

  it('allows the big rewrite once approved', () => {
    const p = planReclaim({ ...base, table: 'videos', totalBytes: 4152 * MB, heapBytes: 1782 * MB,
      toastBytes: 920 * MB, indexBytes: 1449 * MB, liveBytes: 1476 * MB, approved: true });
    expect(p.method).toBe('pg_repack');
  });

  it('says there is nothing worth doing when the table is not bloated', () => {
    const p = planReclaim({ ...base, heapBytes: 100 * MB, totalBytes: 212 * MB, liveBytes: 94 * MB });
    expect(p.method).toBe('refuse');
    expect(p.notes.join(' ')).toMatch(/not worth/);
  });
});

describe('the commands', () => {
  it('runs pg_repack on the session pooler with the version-matched client and a bounded wait', () => {
    const cmd = repackCommand('video_score_history');
    expect(cmd).toMatch(/docker run --rm pg-repack:1\.5\.2-pg15 pg_repack -k/);
    expect(cmd).toMatch(/\$DATABASE_SESSION_URL/);
    expect(cmd).toMatch(/-t public\.video_score_history/);
    expect(cmd).toMatch(/--wait-timeout \d+/);
    expect(cmd).not.toMatch(/--no-superuser-check/); // -k IS that flag; both together is an error
  });

  it('never queues VACUUM FULL behind a long transaction — a lock_timeout fails it fast instead', () => {
    // An ACCESS EXCLUSIVE request waiting in the lock queue blocks every later reader too.
    expect(VACUUM_FULL_SQL('video_score_history')).toMatch(/set lock_timeout = '5s'/);
    expect(VACUUM_FULL_SQL('video_score_history')).toMatch(/vacuum \(full, analyze, verbose\) public\.video_score_history/);
  });

  it('refuses an identifier that is not a plain table name', () => {
    expect(() => repackCommand('x; drop table y')).toThrow();
    expect(() => VACUUM_FULL_SQL('a b')).toThrow();
  });
});
