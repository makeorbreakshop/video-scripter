import { PLANS, planLimits, normalizePlan, canTrackMore, canWatchMoreClosely } from './plans';

describe('plan limits', () => {
  it('matches the MVP plan tiers', () => {
    expect(PLANS.free).toEqual({ tracked: 2, watchedClosely: 1 });
    expect(PLANS.pro).toEqual({ tracked: 25, watchedClosely: 10 });
  });

  it('falls back to free for unknown, null or empty plans', () => {
    for (const p of [null, undefined, '', 'enterprise', 'PRO_TRIAL']) {
      expect(planLimits(p)).toEqual(PLANS.free);
      expect(normalizePlan(p)).toBe('free');
    }
  });

  it('is case-insensitive for known plans', () => {
    expect(planLimits('PRO')).toEqual(PLANS.pro);
    expect(normalizePlan('Free')).toBe('free');
  });
});

describe('canTrackMore', () => {
  it('allows up to the limit and blocks at it', () => {
    expect(canTrackMore('free', 0).ok).toBe(true);
    expect(canTrackMore('free', 1).ok).toBe(true);
    expect(canTrackMore('free', 2).ok).toBe(false);
    expect(canTrackMore('pro', 24).ok).toBe(true);
    expect(canTrackMore('pro', 25).ok).toBe(false);
  });

  it('explains the limit when blocking', () => {
    const r = canTrackMore('free', 2);
    expect(r.reason).toContain('2 channels');
    expect(r.reason).toContain('free');
  });
});

describe('canWatchMoreClosely', () => {
  it('enforces the per-plan slot count', () => {
    expect(canWatchMoreClosely('free', 0).ok).toBe(true);
    expect(canWatchMoreClosely('free', 1).ok).toBe(false);
    expect(canWatchMoreClosely('pro', 9).ok).toBe(true);
    expect(canWatchMoreClosely('pro', 10).ok).toBe(false);
  });

  it('singularises the free-tier message', () => {
    expect(canWatchMoreClosely('free', 1).reason).toContain('1 closely watched channel.');
  });
});

describe('owner plan', () => {
  it('never limits tracking or close watching', () => {
    expect(canTrackMore('owner', 10_000).ok).toBe(true);
    expect(canWatchMoreClosely('owner', 10_000).ok).toBe(true);
    expect(normalizePlan('owner')).toBe('owner');
  });
});
