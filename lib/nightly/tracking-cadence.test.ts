import { TIER_INTERVAL_DAYS, nextTrackDate, rssRollRows, RSS_ROLL_SQL } from './tracking-core';

describe('tier cadence (restored 2026-09-05)', () => {
  it('rolls off with age: daily for the first month, then 3d, 7d, 14d', () => {
    expect(TIER_INTERVAL_DAYS).toEqual({ 0: 1, 1: 1, 2: 3, 3: 7, 4: 14 });
    expect(nextTrackDate(1, '2026-09-05')).toBe('2026-09-06');
    expect(nextTrackDate(2, '2026-09-05')).toBe('2026-09-08');
    expect(nextTrackDate(3, '2026-09-05')).toBe('2026-09-12');
    expect(nextTrackDate(4, '2026-09-05')).toBe('2026-09-19');
  });
});

describe('RSS roll-in', () => {
  it('turns a feed reading into a snapshot row parked on the tier cadence', () => {
    const [row] = rssRollRows([{ video_id: 'v1', views: 1234, likes: 56, priority_tier: 2, days_since_published: 40 }], '2026-09-05');
    expect(row).toMatchObject({ video_id: 'v1', snapshot_date: '2026-09-05', view_count: 1234, like_count: 56, comment_count: null, days_since_published: 40, next_track_date: '2026-09-08' });
  });
  it('carries null likes and never invents a comment count', () => {
    const [row] = rssRollRows([{ video_id: 'v1', views: 10, likes: null, priority_tier: 1, days_since_published: null }], '2026-09-05');
    expect(row.like_count).toBeNull();
    expect(row.comment_count).toBeNull();
    expect(row.days_since_published).toBeNull();
  });
  it('only takes videos that are due, read today, with a positive count', () => {
    expect(RSS_ROLL_SQL).toContain("r.at > now() - interval '20 hours'");
    expect(RSS_ROLL_SQL).toContain('r.views > 0');
    expect(RSS_ROLL_SQL).toContain('p.next_track_date <= $1');
    expect(RSS_ROLL_SQL).toContain('distinct on (r.video_id)');
  });
});
