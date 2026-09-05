import {
  DUE_TIER_BOUNDARIES, tierForAge, dueTierIntervalDays, nextTrackAt, ageDaysAt,
  tickBudget, ticksLeftInDay, idCapForBudget, rssRollDueRows, DUE_SELECT_SQL,
  RSS_FOR_DUE_SQL, TRACK_DUE_DAILY_BUDGET, TICK_INTERVAL_MIN, LAUNCH_HANDOFF_HOURS,
  partitionDue, dueFetchCap, DUE_OVERFETCH,
} from './due-core';
import { chunk } from './tracking-core';

const D = (s: string) => new Date(s);

describe('tierForAge — tier is a function of age at read time', () => {
  it('is daily under 30 days', () => {
    expect(tierForAge(0)).toBe(1);
    expect(tierForAge(29)).toBe(1);
  });
  it('keeps an existing tier 0 in the daily band (same interval, launch marker preserved)', () => {
    expect(tierForAge(5, 0)).toBe(0);
    expect(tierForAge(5, 3)).toBe(1);
  });
  it('is every-3-days from 30 to 180 days', () => {
    expect(tierForAge(30)).toBe(2);
    expect(tierForAge(179)).toBe(2);
  });
  it('is weekly from 180 days to 2 years', () => {
    expect(tierForAge(180)).toBe(3);
    expect(tierForAge(729)).toBe(3);
  });
  it('is fortnightly past 2 years', () => {
    expect(tierForAge(730)).toBe(4);
    expect(tierForAge(5000)).toBe(4);
  });
  it('exposes its boundaries', () => {
    expect(DUE_TIER_BOUNDARIES).toEqual([30, 180, 730]);
  });
  it('maps tiers to the tracking-core intervals', () => {
    expect([0, 1, 2, 3, 4].map(dueTierIntervalDays)).toEqual([1, 1, 3, 7, 14]);
  });
});

describe('nextTrackAt — the video\'s own clock', () => {
  it('makes a never-read video first due one tier-interval after publish', () => {
    // published 2026-09-01, never read: age 0 -> tier 1 -> +1 day
    const r = nextTrackAt(D('2026-09-01T12:00:00Z'), null, null);
    expect(r.next_track_at.toISOString()).toBe('2026-09-02T12:00:00.000Z');
    expect(r.tier).toBe(1);
  });
  it('makes an old never-read video due long ago, not now', () => {
    const r = nextTrackAt(D('2020-01-01T00:00:00Z'), null, 4);
    expect(r.next_track_at.toISOString()).toBe('2020-01-02T00:00:00.000Z');
  });
  it('schedules from the last read, not from now', () => {
    // published 2026-08-01, read 2026-08-20 (age 19d -> tier 1 -> +1 day)
    const r = nextTrackAt(D('2026-08-01T00:00:00Z'), D('2026-08-20T06:00:00Z'), 1);
    expect(r.next_track_at.toISOString()).toBe('2026-08-21T06:00:00.000Z');
    expect(r.tier).toBe(1);
  });
  it('rolls a video off to a sparser tier as it ages across a boundary', () => {
    // published 2026-01-01; read at 2026-02-05 => age 35d => tier 2 => +3 days
    const r = nextTrackAt(D('2026-01-01T00:00:00Z'), D('2026-02-05T00:00:00Z'), 1);
    expect(r.tier).toBe(2);
    expect(r.next_track_at.toISOString()).toBe('2026-02-08T00:00:00.000Z');
  });
  it('rolls a two-year-old video to fortnightly', () => {
    const r = nextTrackAt(D('2024-01-01T00:00:00Z'), D('2026-06-01T00:00:00Z'), 3);
    expect(r.tier).toBe(4);
    expect(r.next_track_at.toISOString()).toBe('2026-06-15T00:00:00.000Z');
  });
  it('never returns a tier lower than the daily band for a young video', () => {
    const r = nextTrackAt(D('2026-09-01T00:00:00Z'), D('2026-09-03T00:00:00Z'), 4);
    expect(r.tier).toBe(1);
  });
  it('computes whole days of age', () => {
    expect(ageDaysAt(D('2026-01-01T00:00:00Z'), D('2026-01-31T23:00:00Z'))).toBe(30);
  });
});

describe('tickBudget — spread the day\'s allowance across the day', () => {
  it('divides what is left by the ticks that remain', () => {
    expect(tickBudget(0, 6000, 96)).toBe(62);
    expect(tickBudget(3000, 6000, 50)).toBe(60);
  });
  it('returns 0 once the day\'s budget is spent', () => {
    expect(tickBudget(6000, 6000, 10)).toBe(0);
    expect(tickBudget(9999, 6000, 10)).toBe(0);
  });
  it('spends the remainder on the last tick rather than stalling', () => {
    expect(tickBudget(5900, 6000, 1)).toBe(100);
    expect(tickBudget(5900, 6000, 0)).toBe(100);
  });
  it('defaults the tracking allowance to 6000 units on a 15-minute tick', () => {
    expect(TRACK_DUE_DAILY_BUDGET).toBe(6000);
    expect(TICK_INTERVAL_MIN).toBe(15);
  });
  it('counts the 15-minute ticks left in the UTC day', () => {
    expect(ticksLeftInDay(D('2026-09-05T00:00:00Z'), 15)).toBe(96);
    expect(ticksLeftInDay(D('2026-09-05T23:50:00Z'), 15)).toBe(1);
    expect(ticksLeftInDay(D('2026-09-05T12:00:00Z'), 15)).toBe(48);
  });
});

describe('batch shaping', () => {
  it('turns a call budget into an id cap of 50 per call', () => {
    expect(idCapForBudget(62)).toBe(3100);
    expect(idCapForBudget(0)).toBe(0);
  });
  it('chunks ids into 50-id calls with a short final call', () => {
    const ids = Array.from({ length: 120 }, (_, i) => `v${i}`);
    const batches = chunk(ids, 50);
    expect(batches.map((b) => b.length)).toEqual([50, 50, 20]);
  });
});

describe('RSS roll-in takes precedence over an API read', () => {
  const now = D('2026-09-05T10:00:00Z');
  const due = (id: string, published: string, tier = 1) =>
    ({ video_id: id, priority_tier: tier, published_at: D(published) });

  it('turns a feed reading into today\'s snapshot at zero quota and reschedules on the age tier', () => {
    const [row] = rssRollDueRows(
      [{ ...due('v1', '2026-01-01T00:00:00Z'), views: 1234, likes: 56 }],
      now
    );
    expect(row.view_count).toBe(1234);
    expect(row.like_count).toBe(56);
    expect(row.snapshot_date).toBe('2026-09-05');
    expect(row.days_since_published).toBe(247);
    // age 247d -> tier 3 -> weekly
    expect(row.tier).toBe(3);
    expect(row.next_track_at.toISOString()).toBe('2026-09-12T10:00:00.000Z');
  });

  it('carries a null like count through', () => {
    const [row] = rssRollDueRows(
      [{ ...due('v1', '2026-09-01T00:00:00Z'), views: 10, likes: null }],
      now
    );
    expect(row.like_count).toBeNull();
    expect(row.tier).toBe(1);
  });

  it('spends the API budget only on the due videos the feed did NOT cover', () => {
    const rows = [due('a', '2026-01-01T00:00:00Z'), due('b', '2026-01-01T00:00:00Z'),
                  due('c', '2026-01-01T00:00:00Z'), due('d', '2026-01-01T00:00:00Z')];
    const rss = new Map([['b', { video_id: 'b', views: 5, likes: 1 }]]);
    const { rssRows, apiRows } = partitionDue(rows, rss, 10);
    expect(rssRows.map((r) => r.video_id)).toEqual(['b']);
    expect(apiRows.map((r) => r.video_id)).toEqual(['a', 'c', 'd']);
  });

  it('caps only the API side, and keeps it oldest-due first', () => {
    const rows = ['a', 'b', 'c', 'd', 'e'].map((id) => due(id, '2026-01-01T00:00:00Z'));
    const rss = new Map([['a', { video_id: 'a', views: 5, likes: null }]]);
    const { rssRows, apiRows } = partitionDue(rows, rss, 2);
    expect(rssRows).toHaveLength(1);
    expect(apiRows.map((r) => r.video_id)).toEqual(['b', 'c']);
  });

  it('over-fetches the due slice so free readings cannot crowd out paid ones', () => {
    expect(DUE_OVERFETCH).toBe(4);
    expect(dueFetchCap(3100)).toBe(12400);
    expect(dueFetchCap(20000)).toBe(50000); // bounded, whatever the budget
  });

  it('probes the feed by the tick\'s own due ids, never scanning the whole 20h window', () => {
    // one rss_samples_pkey probe per due id, not a scan of the whole feed window
    expect(RSS_FOR_DUE_SQL).toMatch(/unnest\(\$1::text\[\]\)/);
    expect(RSS_FOR_DUE_SQL).toMatch(/cross join lateral/);
    expect(RSS_FOR_DUE_SQL).toMatch(/r\.video_id = x\.video_id/);
    expect(RSS_FOR_DUE_SQL).toMatch(/interval '20 hours'/);
    expect(RSS_FOR_DUE_SQL).not.toMatch(/view_tracking_priority/);
    // the due-select is what bounds the tick
    expect(DUE_SELECT_SQL).toMatch(/next_track_at\s*<=\s*now\(\)/);
    expect(DUE_SELECT_SQL).toMatch(/order by p\.next_track_at asc/);
  });
});

describe('handoff from the launch tracker', () => {
  it('leaves the first 72 hours to scripts/launch-track.ts in both passes', () => {
    expect(LAUNCH_HANDOFF_HOURS).toBe(72);
    expect(DUE_SELECT_SQL).toMatch(/published_at < now\(\) - interval '72 hours'/);
  });
});

