import {
  WEBSUB, topicUrl, subscribeParams, isHubAccepted, isRetryableHubStatus,
  retryDelayMs, leaseIsVerified, DUE_LEASES_SQL, LEASE_UPSERT_SQL, dueLeaseIds, batches,
} from './lease-policy';

describe('topic + request shape', () => {
  it('uses the canonical YouTube feed topic URL', () => {
    expect(topicUrl('UCabc')).toBe('https://www.youtube.com/xml/feeds/videos.xml?channel_id=UCabc');
  });

  it('builds a subscribe body with callback, lease and secret', () => {
    const p = subscribeParams({ channelId: 'UCabc', callback: 'https://x.dev/api/websub', secret: 's3cr3t' });
    expect(p.get('hub.mode')).toBe('subscribe');
    expect(p.get('hub.topic')).toBe(topicUrl('UCabc'));
    expect(p.get('hub.callback')).toBe('https://x.dev/api/websub');
    expect(p.get('hub.lease_seconds')).toBe(String(WEBSUB.leaseSeconds));
    expect(p.get('hub.secret')).toBe('s3cr3t');
    expect(p.get('hub.verify')).toBe('async');
  });

  it('omits hub.secret when there is none', () => {
    expect(subscribeParams({ channelId: 'UCabc', callback: 'https://x.dev/w' }).get('hub.secret')).toBeNull();
  });
});

describe('hub response classification', () => {
  it('accepts only 202/204', () => {
    expect(isHubAccepted(202)).toBe(true);
    expect(isHubAccepted(204)).toBe(true);
    expect(isHubAccepted(200)).toBe(false);
    expect(isHubAccepted(503)).toBe(false);
  });

  // MEASURED 2026-09-06: pubsubhubbub answers "503 Transient error; please try again later"
  // with Retry-After: 120 once the source IP is throttled. That, unretried, is the whole of
  // the 968/1025 failure run.
  it('treats 503/429/5xx as retryable and 4xx as terminal', () => {
    expect(isRetryableHubStatus(503)).toBe(true);
    expect(isRetryableHubStatus(429)).toBe(true);
    expect(isRetryableHubStatus(500)).toBe(true);
    expect(isRetryableHubStatus(400)).toBe(false);
    expect(isRetryableHubStatus(404)).toBe(false);
  });

  it('honours Retry-After over exponential backoff, and grows otherwise', () => {
    expect(retryDelayMs(1, 120)).toBe(120_000);
    expect(retryDelayMs(2, null)).toBeGreaterThan(retryDelayMs(1, null));
    expect(retryDelayMs(9, null)).toBeLessThanOrEqual(WEBSUB.retryCapMs);
  });
});

describe('lease expiry selection', () => {
  const now = new Date('2026-09-06T00:00:00Z');
  const at = (d: number) => new Date(now.getTime() + d * 86400000).toISOString();

  it('is verified only with a verification stamp and an unexpired lease', () => {
    expect(leaseIsVerified({ last_verified_at: at(-1), lease_expires_at: at(5) }, now)).toBe(true);
    expect(leaseIsVerified({ last_verified_at: null, lease_expires_at: at(5) }, now)).toBe(false);
    expect(leaseIsVerified({ last_verified_at: at(-9), lease_expires_at: at(-1) }, now)).toBe(false);
    expect(leaseIsVerified(undefined, now)).toBe(false);
  });

  it('picks never-subscribed channels and leases expiring inside the renew window', () => {
    const ids = dueLeaseIds([
      { channel_id: 'never', lease_expires_at: null, last_verified_at: null },
      { channel_id: 'expiring', lease_expires_at: at(1), last_verified_at: at(-8) },
      { channel_id: 'fresh', lease_expires_at: at(8), last_verified_at: at(-1) },
      { channel_id: 'expired', lease_expires_at: at(-1), last_verified_at: at(-10) },
      { channel_id: 'unverified-but-fresh', lease_expires_at: at(8), last_verified_at: null },
    ], now);
    expect(ids).toEqual(['never', 'expiring', 'expired', 'unverified-but-fresh']);
  });

  it('SQL selects the same set, parameterised by the renew window', () => {
    expect(DUE_LEASES_SQL).toMatch(/lease_expires_at is null/);
    expect(DUE_LEASES_SQL).toMatch(/last_verified_at is null/);
    expect(DUE_LEASES_SQL).toContain(`${WEBSUB.renewWithinSec}`);
    expect(DUE_LEASES_SQL).toMatch(/channel_rss_state/);
  });

  it('records the hub status and body on every attempt, success or not', () => {
    expect(LEASE_UPSERT_SQL).toMatch(/on conflict \(channel_id\) do update/);
    expect(LEASE_UPSERT_SQL).toMatch(/last_hub_status/);
    expect(LEASE_UPSERT_SQL).toMatch(/last_hub_body/);
    expect(LEASE_UPSERT_SQL).toMatch(/failures/);
    // A success resets the failure counter; a rejection increments it.
    expect(LEASE_UPSERT_SQL).toMatch(/case when excluded\.last_hub_status in \(202, ?204\)/);
    // Verification/push stamps are owned by the receiver and must survive a re-subscribe.
    expect(LEASE_UPSERT_SQL).not.toMatch(/last_verified_at = excluded/);
  });
});

describe('batch shaping', () => {
  it('splits into concurrency-sized groups, preserving order and losing nothing', () => {
    const ids = Array.from({ length: 23 }, (_, i) => `c${i}`);
    const gs = batches(ids, 5);
    expect(gs).toHaveLength(5);
    expect(gs[0]).toHaveLength(5);
    expect(gs[4]).toHaveLength(3);
    expect(gs.flat()).toEqual(ids);
  });

  it('paces below the rate that got the source IP throttled', () => {
    // The 2026-09-01 run was 10-wide with a 300 ms gap: ~33 subscribes/s. It died at 57.
    expect(WEBSUB.concurrency / (WEBSUB.batchPauseMs / 1000)).toBeLessThanOrEqual(5);
  });
});
