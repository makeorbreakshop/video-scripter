import {
  dueTier,
  tierOf,
  TIER_THRESHOLDS as T,
  LONG_TAIL_TIERS,
  LONG_TAIL_MAX_PER_RUN,
  isLongTailRun,
  isEligible,
  HOT_TARGETS_SQL,
  LONG_TAIL_TARGETS_SQL,
  TIER_COUNTS_SQL,
} from './watch-policy';

const NOW = new Date('2026-09-02T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const hours = (h: number) => h * 3600_000;
const days = (d: number) => d * 24 * 3600_000;

describe('tierOf (age bucket, ignores last check)', () => {
  it('buckets by published age', () => {
    expect(tierOf(ago(hours(1)), NOW)).toBe('launch');
    expect(tierOf(ago(hours(5.9)), NOW)).toBe('launch');
    expect(tierOf(ago(hours(6.1)), NOW)).toBe('hot');
    expect(tierOf(ago(hours(71)), NOW)).toBe('hot');
    expect(tierOf(ago(hours(73)), NOW)).toBe('warm');
    expect(tierOf(ago(days(29)), NOW)).toBe('warm');
    expect(tierOf(ago(days(31)), NOW)).toBe('cool');
    expect(tierOf(ago(days(89)), NOW)).toBe('cool');
    expect(tierOf(ago(days(91)), NOW)).toBe('cold');
    expect(tierOf(ago(days(3000)), NOW)).toBe('cold');
  });
  it('treats future/unknown publish dates as launch', () => {
    expect(tierOf(new Date(NOW.getTime() + hours(2)), NOW)).toBe('launch');
  });
});

describe('dueTier', () => {
  it('launch videos are due every run regardless of last check', () => {
    expect(dueTier(ago(hours(1)), NOW, NOW)).toBe('launch');
    expect(dueTier(ago(hours(1)), null, NOW)).toBe('launch');
  });

  it('hot videos are due every ~30 minutes', () => {
    const pub = ago(hours(24));
    expect(dueTier(pub, ago(hours(1)), NOW)).toBe('hot');
    expect(dueTier(pub, ago(60_000 * 26), NOW)).toBe('hot');
    expect(dueTier(pub, ago(60_000 * 10), NOW)).toBeNull();
    expect(dueTier(pub, null, NOW)).toBe('hot');
  });

  it('warm videos are due daily', () => {
    const pub = ago(days(10));
    expect(dueTier(pub, ago(hours(24)), NOW)).toBe('warm');
    expect(dueTier(pub, ago(hours(2)), NOW)).toBeNull();
    expect(dueTier(pub, null, NOW)).toBe('warm');
  });

  it('30-90 day videos are due weekly', () => {
    const pub = ago(days(60));
    expect(dueTier(pub, ago(days(8)), NOW)).toBe('cool');
    expect(dueTier(pub, ago(days(3)), NOW)).toBeNull();
    expect(dueTier(pub, null, NOW)).toBe('cool');
    expect(T.coolRecheckDays).toBe(7);
  });

  it('videos over 90 days are due monthly', () => {
    const pub = ago(days(400));
    expect(dueTier(pub, ago(days(31)), NOW)).toBe('cold');
    expect(dueTier(pub, ago(days(20)), NOW)).toBeNull();
    expect(dueTier(pub, null, NOW)).toBe('cold');
    expect(T.coldRecheckDays).toBe(30);
  });

  it('existing tier thresholds are unchanged', () => {
    expect(T.launchMaxAgeHours).toBe(6);
    expect(T.hotMaxAgeHours).toBe(72);
    expect(T.hotRecheckMinutes).toBe(25);
    expect(T.warmMaxAgeDays).toBe(30);
    expect(T.warmRecheckHours).toBe(23);
  });
});

describe('long-tail budget', () => {
  it('only cool and cold are long tail', () => {
    expect(LONG_TAIL_TIERS).toEqual(['cool', 'cold']);
    expect(LONG_TAIL_MAX_PER_RUN).toBeLessThanOrEqual(4000);
  });
  it('long tail runs at most once an hour (LaunchAgent fires every 5 min)', () => {
    expect(isLongTailRun(new Date('2026-09-02T12:00:00Z'))).toBe(true);
    expect(isLongTailRun(new Date('2026-09-02T12:04:00Z'))).toBe(true);
    expect(isLongTailRun(new Date('2026-09-02T12:05:00Z'))).toBe(false);
    expect(isLongTailRun(new Date('2026-09-02T12:35:00Z'))).toBe(false);
    expect(isLongTailRun(new Date('2026-09-02T13:01:00Z'))).toBe(true);
  });
});

describe('SQL shape', () => {
  it('hot query keeps the 30-day window and short/live exclusions', () => {
    expect(HOT_TARGETS_SQL).toContain("interval '30 days'");
    expect(HOT_TARGETS_SQL).toContain("interval '6 hours'");
    expect(HOT_TARGETS_SQL).toContain("interval '72 hours'");
    expect(HOT_TARGETS_SQL).toContain("interval '25 minutes'");
    expect(HOT_TARGETS_SQL).toContain("interval '23 hours'");
    expect(HOT_TARGETS_SQL).toContain("<> 'P0D'");
    expect(HOT_TARGETS_SQL).toContain('is_short');
    expect(HOT_TARGETS_SQL).toContain('order by v.published_at desc');
  });
  it('long-tail query uses indexed published_at ranges and its own recheck windows', () => {
    expect(LONG_TAIL_TARGETS_SQL).toContain("interval '30 days'");
    expect(LONG_TAIL_TARGETS_SQL).toContain("interval '90 days'");
    expect(LONG_TAIL_TARGETS_SQL).toContain("interval '7 days'");
    expect(LONG_TAIL_TARGETS_SQL).toContain("<> 'P0D'");
    expect(LONG_TAIL_TARGETS_SQL).toContain('limit');
  });
});

describe('eligibility applies in every tier', () => {
  it('excludes live/upcoming and Shorts, keeps real uploads', () => {
    expect(isEligible({ duration: 'PT10M5S', is_short: false })).toBe(true);
    expect(isEligible({ duration: 'PT10M5S', is_short: null })).toBe(true);
    expect(isEligible({ duration: 'P0D', is_short: false })).toBe(false);
    expect(isEligible({ duration: 'PT10M5S', is_short: true })).toBe(false);
    expect(isEligible({ duration: 'PT59S', is_short: false })).toBe(false);
    expect(isEligible({ duration: 'PT1M2S', is_short: false })).toBe(false);
    expect(isEligible({ duration: 'PT1M3S', is_short: false })).toBe(true);
  });

  it.each([
    ['hot', HOT_TARGETS_SQL],
    ['long tail', LONG_TAIL_TARGETS_SQL],
    ['tier counts', TIER_COUNTS_SQL],
  ])('%s query filters Shorts and live in every branch', (_name, sql) => {
    expect(sql).toContain("coalesce(v.duration, '') <> 'P0D'");
    expect(sql).toContain('coalesce(v.is_short, false) = false');
    expect(sql).toContain("^PT(([0-5]?[0-9])S|1M([0-2]S)?)$");
  });
});
