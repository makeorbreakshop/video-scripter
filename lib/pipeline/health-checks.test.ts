import { shortsUnverifiedStatus, SHORTS_UNVERIFIED_WARN, SHORTS_UNVERIFIED_FAIL } from './health-checks';

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
