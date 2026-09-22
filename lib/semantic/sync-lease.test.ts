import { acquireOutcome, canBreak, holderId, leaseState, LeaseRow } from './sync-lease';

const now = new Date('2026-09-22T12:00:00Z');
const row = (expiresInMs: number, holder = 'mac:1:2026-09-22T11:00:00.000Z'): LeaseRow => ({
  holder,
  acquired_at: new Date('2026-09-22T11:00:00Z'),
  heartbeat_at: new Date(now.getTime() - 30_000),
  expires_at: new Date(now.getTime() + expiresInMs),
});

describe('leaseState', () => {
  it('is free with no row', () => expect(leaseState(null, now)).toBe('free'));
  it('is held before expiry', () => expect(leaseState(row(1), now)).toBe('held'));
  it('is stale at and after expiry', () => {
    expect(leaseState(row(0), now)).toBe('stale');
    expect(leaseState(row(-60_000), now)).toBe('stale');
  });
});

describe('canBreak', () => {
  it('only clears an expired lease', () => {
    expect(canBreak(row(-1), now)).toBe(true);
    expect(canBreak(row(60_000), now)).toBe(false);
    expect(canBreak(null, now)).toBe(false);
  });
});

describe('acquireOutcome', () => {
  it('reports a fresh acquire', () => {
    expect(acquireOutcome(null, true, null, now, 12)).toEqual({
      lock: 'acquired', waited_ms: 12, took_over_stale_from: null, stale_since: null,
    });
  });

  it('names the stale holder it displaced', () => {
    const stale = row(-120_000, 'mac:999:x');
    expect(acquireOutcome(stale, true, null, now, 5)).toEqual({
      lock: 'acquired', waited_ms: 5, took_over_stale_from: 'mac:999:x', stale_since: stale.expires_at.toISOString(),
    });
  });

  it('does not call a live row a takeover even if the upsert won (row released between reads)', () => {
    expect(acquireOutcome(row(60_000), true, null, now, 5).lock).toBe('acquired');
    expect((acquireOutcome(row(60_000), true, null, now, 5) as { took_over_stale_from: string | null }).took_over_stale_from).toBeNull();
  });

  it('reports who holds it and since when on skip', () => {
    const live = row(200_000, 'mac:42:y');
    expect(acquireOutcome(null, false, live, now, 300)).toEqual({
      lock: 'skipped', waited_ms: 300, held_by: 'mac:42:y',
      held_since: '2026-09-22T11:00:00.000Z', expires_at: live.expires_at.toISOString(),
    });
  });

  it('throws if the upsert was rejected but no row can be found', () => {
    expect(() => acquireOutcome(null, false, null, now, 1)).toThrow(/no lease row/);
  });
});

describe('holderId', () => {
  it('is host:pid:start', () => {
    expect(holderId('mac', 7, now)).toBe('mac:7:2026-09-22T12:00:00.000Z');
  });
});
