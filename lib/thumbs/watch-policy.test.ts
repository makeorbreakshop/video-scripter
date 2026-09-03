import {
  dueTier,
  tierOf,
  recheckIntervalMs,
  LADDERS,
  TIER_ORDER,
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
  it('buckets by published age on the new subset ladder', () => {
    expect(tierOf(ago(hours(1)), NOW)).toBe('launch');
    expect(tierOf(ago(hours(23)), NOW)).toBe('launch');
    expect(tierOf(ago(hours(25)), NOW)).toBe('hot');
    expect(tierOf(ago(days(2)), NOW)).toBe('hot');
    expect(tierOf(ago(days(4)), NOW)).toBe('warm');
    expect(tierOf(ago(days(13)), NOW)).toBe('warm');
    expect(tierOf(ago(days(15)), NOW)).toBe('steady');
    expect(tierOf(ago(days(29)), NOW)).toBe('steady');
    expect(tierOf(ago(days(31)), NOW)).toBe('cool');
    expect(tierOf(ago(days(89)), NOW)).toBe('cool');
    expect(tierOf(ago(days(91)), NOW)).toBe('cold');
  });

  it('keeps the old buckets for videos still on the legacy ladder', () => {
    expect(tierOf(ago(hours(5)), NOW, 'legacy')).toBe('launch');
    expect(tierOf(ago(hours(7)), NOW, 'legacy')).toBe('hot');
    expect(tierOf(ago(hours(71)), NOW, 'legacy')).toBe('hot');
    expect(tierOf(ago(days(10)), NOW, 'legacy')).toBe('warm');
    expect(tierOf(ago(days(60)), NOW, 'legacy')).toBe('cool');
    expect(tierOf(ago(days(400)), NOW, 'legacy')).toBe('cold');
    expect(tierOf(ago(days(15)), NOW, 'legacy')).toBe('warm'); // no 'steady' rung on legacy
  });

  it('treats future/unknown publish dates as launch', () => {
    expect(tierOf(new Date(NOW.getTime() + hours(2)), NOW)).toBe('launch');
  });
});

describe('the two ladders', () => {
  it('the new cadence is the one the plan specifies', () => {
    expect(recheckIntervalMs('launch')).toBe(0);
    expect(recheckIntervalMs('hot')).toBe(15 * 60_000);
    expect(recheckIntervalMs('warm')).toBe(30 * 60_000);
    expect(recheckIntervalMs('steady')).toBe(hours(2));
    expect(recheckIntervalMs('cool')).toBe(hours(24));
    expect(recheckIntervalMs('cold')).toBe(days(7));
  });

  it('the legacy cadence is untouched: nothing outside watch_subset speeds up during the test', () => {
    expect(recheckIntervalMs('launch', 'legacy')).toBe(0);
    expect(recheckIntervalMs('hot', 'legacy')).toBe(25 * 60_000);
    expect(recheckIntervalMs('warm', 'legacy')).toBe(hours(23));
    expect(recheckIntervalMs('cool', 'legacy')).toBe(days(7));
    expect(recheckIntervalMs('cold', 'legacy')).toBe(days(30));
  });

  it('both ladders split the long tail at the same 30-day boundary', () => {
    for (const cadence of ['subset', 'legacy'] as const) {
      const longTail = LADDERS[cadence].filter((r) => LONG_TAIL_TIERS.includes(r.tier));
      expect(longTail.map((r) => r.tier)).toEqual(['cool', 'cold']);
    }
    expect(TIER_ORDER).toEqual(['launch', 'hot', 'warm', 'steady', 'cool', 'cold']);
  });
});

describe('dueTier', () => {
  it('launch videos are due every run regardless of last check', () => {
    expect(dueTier(ago(hours(20)), NOW, NOW)).toBe('launch');
    expect(dueTier(ago(hours(20)), null, NOW)).toBe('launch');
  });

  it('1-3 day videos are due every 15 minutes', () => {
    const pub = ago(days(2));
    expect(dueTier(pub, ago(60_000 * 16), NOW)).toBe('hot');
    expect(dueTier(pub, ago(60_000 * 10), NOW)).toBeNull();
    expect(dueTier(pub, null, NOW)).toBe('hot');
  });

  it('3-14 day videos are due every 30 minutes', () => {
    const pub = ago(days(7));
    expect(dueTier(pub, ago(60_000 * 31), NOW)).toBe('warm');
    expect(dueTier(pub, ago(60_000 * 20), NOW)).toBeNull();
  });

  it('14-30 day videos are due every 2 hours', () => {
    const pub = ago(days(20));
    expect(dueTier(pub, ago(hours(3)), NOW)).toBe('steady');
    expect(dueTier(pub, ago(hours(1)), NOW)).toBeNull();
  });

  it('30-90 day videos are due daily, over 90 weekly', () => {
    expect(dueTier(ago(days(60)), ago(hours(25)), NOW)).toBe('cool');
    expect(dueTier(ago(days(60)), ago(hours(2)), NOW)).toBeNull();
    expect(dueTier(ago(days(400)), ago(days(8)), NOW)).toBe('cold');
    expect(dueTier(ago(days(400)), ago(days(3)), NOW)).toBeNull();
  });

  it('a legacy-ladder video keeps its old, slower due times', () => {
    expect(dueTier(ago(days(10)), ago(hours(2)), NOW, 'legacy')).toBeNull();
    expect(dueTier(ago(days(10)), ago(hours(24)), NOW, 'legacy')).toBe('warm');
  });

  // The RSS poller / WebSub "due now" mark is last_checked = 'epoch'. It has to win in EVERY
  // tier of BOTH ladders, or a swap on an old video would still wait for its normal window.
  it('the epoch due-now sentinel makes a video due in every tier of both ladders', () => {
    const epoch = new Date(0);
    for (const cadence of ['subset', 'legacy'] as const) {
      for (const age of [hours(1), days(2), days(7), days(20), days(60), days(400)]) {
        expect(dueTier(ago(age), epoch, NOW, cadence)).not.toBeNull();
      }
    }
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
  it('the hot query keeps the 30-day window and carries BOTH ladders behind the subset gate', () => {
    expect(HOT_TARGETS_SQL).toContain("interval '30 days'");
    expect(HOT_TARGETS_SQL).toContain('watch_subset');
    expect(HOT_TARGETS_SQL).toContain('$1::boolean');
    // new ladder
    expect(HOT_TARGETS_SQL).toContain("interval '24 hours'");
    expect(HOT_TARGETS_SQL).toContain("interval '15 minutes'");
    expect(HOT_TARGETS_SQL).toContain("interval '30 minutes'");
    expect(HOT_TARGETS_SQL).toContain("interval '2 hours'");
    // legacy ladder, unchanged
    expect(HOT_TARGETS_SQL).toContain("interval '6 hours'");
    expect(HOT_TARGETS_SQL).toContain("interval '25 minutes'");
    expect(HOT_TARGETS_SQL).toContain("interval '23 hours'");
    expect(HOT_TARGETS_SQL).toContain('order by v.published_at desc');
  });

  it('the long-tail query keeps its indexed published_at ranges and its own recheck windows', () => {
    expect(LONG_TAIL_TARGETS_SQL).toContain("interval '30 days'");
    expect(LONG_TAIL_TARGETS_SQL).toContain("interval '90 days'");
    expect(LONG_TAIL_TARGETS_SQL).toContain("interval '7 days'");
    expect(LONG_TAIL_TARGETS_SQL).toContain('limit $2');
    // the LATERAL shape is what keeps this off a 560K-row seq scan
    expect(LONG_TAIL_TARGETS_SQL).toContain('left join lateral');
  });

  it('the hot and long-tail queries partition the corpus at 30 days with no overlap', () => {
    expect(HOT_TARGETS_SQL).toContain("v.published_at > now() - interval '30 days'");
    expect(LONG_TAIL_TARGETS_SQL).toContain("v.published_at <= now() - interval '30 days'");
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
    // Shorts run to 3 minutes now: an unverified clip up to 180s is treated as a Short until
    // scripts/verify-shorts.ts has asked YouTube; a verified one is a real upload.
    expect(isEligible({ duration: 'PT1M3S', is_short: false })).toBe(false);
    expect(isEligible({ duration: 'PT2M59S', is_short: false, shorts_checked_at: null })).toBe(false);
    expect(isEligible({ duration: 'PT2M59S', is_short: false, shorts_checked_at: '2026-09-03T00:00:00Z' })).toBe(true);
    expect(isEligible({ duration: 'PT3M1S', is_short: false })).toBe(true);
  });

  it.each([
    ['hot', HOT_TARGETS_SQL],
    ['long tail', LONG_TAIL_TARGETS_SQL],
    ['tier counts', TIER_COUNTS_SQL],
  ])('%s query filters Shorts and live in every branch', (_name, sql) => {
    expect(sql).toContain("coalesce(v.duration, '') <> 'P0D'");
    expect(sql).toContain('coalesce(v.is_short, false) = false');
    expect(sql).toContain('v.shorts_checked_at is null'); // the shared long-form rule (lib/scoring/longform)
  });
});
