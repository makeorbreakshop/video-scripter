import {
  nextTrackDate,
  buildSnapshotRows,
  chunk,
  parseRssVideoIds,
  selectCatalogSlice,
  catalogCycleDays,
  catalogNextTrackDate,
  CATALOG_MIN_TIER,
  CATALOG_MAX_CYCLE_DAYS,
  CATALOG_CANDIDATES_SQL,
} from './tracking-core';
import fs from 'fs';
import path from 'path';

describe('nextTrackDate', () => {
  const today = '2026-08-31';
  it('schedules by tier interval', () => {
    // DENSE MODE: tiers 0-3 daily during the modeling window, archive weekly
    expect(nextTrackDate(0, today)).toBe('2026-09-01');
    expect(nextTrackDate(1, today)).toBe('2026-09-01');
    expect(nextTrackDate(2, today)).toBe('2026-09-01');
    expect(nextTrackDate(3, today)).toBe('2026-09-01');
    expect(nextTrackDate(4, today)).toBe('2026-09-07');
  });
  it('treats unknown tiers as weekly (dense mode)', () => {
    expect(nextTrackDate(99, today)).toBe('2026-09-07');
  });
});

describe('buildSnapshotRows', () => {
  const today = '2026-08-31';
  const apiItems = [
    { id: 'a', statistics: { viewCount: '1000', likeCount: '10', commentCount: '2' } },
    { id: 'b', statistics: {} },
    { id: 'missing', statistics: { viewCount: '5' } },
  ];
  const tracked = new Map([
    ['a', { priority_tier: 1, days_since_published: 10 }],
    ['b', { priority_tier: 3, days_since_published: 400 }],
  ]);
  const prev = new Map([['a', { view_count: 500, snapshot_date: '2026-08-21' }]]);

  it('builds one row per API item that we track, with daily rate from previous snapshot', () => {
    const rows = buildSnapshotRows(apiItems, tracked, prev, today);
    expect(rows).toHaveLength(2); // 'missing' is not tracked -> dropped
    const a = rows.find((r) => r.video_id === 'a')!;
    expect(a.view_count).toBe(1000);
    expect(a.like_count).toBe(10);
    expect(a.daily_views_rate).toBe(50); // (1000-500)/10 days
    expect(a.next_track_date).toBe('2026-09-01'); // tier 1 -> daily
  });

  it('defaults missing stats to zero and null rate without previous snapshot', () => {
    const b = buildSnapshotRows(apiItems, tracked, prev, today).find((r) => r.video_id === 'b')!;
    expect(b.view_count).toBe(0);
    expect(b.daily_views_rate).toBeNull();
    expect(b.next_track_date).toBe('2026-09-01'); // tier 3 -> daily in dense mode
  });
});

describe('chunk', () => {
  it('splits into fixed-size groups', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});

describe('parseRssVideoIds', () => {
  it('extracts video ids from a YouTube channel feed', () => {
    const xml = `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
      <entry><yt:videoId>abc123DEF45</yt:videoId></entry>
      <entry><yt:videoId>zzz999YYY88</yt:videoId></entry></feed>`;
    expect(parseRssVideoIds(xml)).toEqual(['abc123DEF45', 'zzz999YYY88']);
  });
  it('returns empty for malformed xml', () => {
    expect(parseRssVideoIds('<html>not a feed</html>')).toEqual([]);
  });
});


// The reserved archive slice: tiers 3/4 have one snapshot each from Jul/Aug 2025 because the
// tier-ordered due-list never reaches them, which is why the long-tail fit has no support past
// 365 days. selectCatalogSlice is what makes the back catalogue rotate.
describe('selectCatalogSlice', () => {
  const v = (id: string, tier: number, last: string | null) => ({
    video_id: id, priority_tier: tier, last_tracked: last, days_since_published: 800,
  });

  it('takes the oldest-read archive videos first', () => {
    const picked = selectCatalogSlice(
      [v('c', 3, '2025-09-04'), v('a', 4, '2025-07-22'), v('b', 3, '2025-08-20')],
      3
    );
    expect(picked.map((p) => p.video_id)).toEqual(['a', 'b', 'c']);
  });

  // MEASURED 2026-09-03: NULL last_tracked on this corpus means "imported recently, ingest
  // already snapshotted it" (42% of a 1,000-row sample had a snapshot inside the week), not
  // "never measured". Taking nulls first burned a whole slice on 1-2 day spans and every
  // ratio came back 1.00. The dated rows are the 13-month spans the tail fit needs.
  it('sorts never-tracked rows LAST, behind every dated row', () => {
    const picked = selectCatalogSlice(
      [v('n', 3, null), v('a', 4, '2025-07-22'), v('z', 3, '2026-09-01')],
      3
    );
    expect(picked.map((p) => p.video_id)).toEqual(['a', 'z', 'n']);
    expect(selectCatalogSlice([v('n', 3, null), v('a', 4, '2025-07-22')], 1).map((p) => p.video_id))
      .toEqual(['a']);
  });

  it('never takes a tier below the archive floor, however stale it is', () => {
    const picked = selectCatalogSlice(
      [v('t0', 0, '2024-01-01'), v('t1', 1, '2024-01-01'), v('t2', 2, '2024-01-01'), v('t3', 3, '2026-09-01')],
      10
    );
    expect(picked.map((p) => p.video_id)).toEqual(['t3']);
    expect(CATALOG_MIN_TIER).toBe(3);
  });

  it('caps the slice at the limit, and takes nothing at limit 0 or below', () => {
    const pool = Array.from({ length: 50 }, (_, i) => v(`v${String(i).padStart(2, '0')}`, 3, '2025-08-01'));
    expect(selectCatalogSlice(pool, 10)).toHaveLength(10);
    expect(selectCatalogSlice(pool, 0)).toEqual([]);
    expect(selectCatalogSlice(pool, -5)).toEqual([]);
    expect(selectCatalogSlice(pool, 999)).toHaveLength(50);
  });

  it('breaks last_tracked ties on video_id so a night is deterministic', () => {
    const same = '2025-08-01';
    expect(selectCatalogSlice([v('z', 3, same), v('a', 4, same), v('m', 3, same)], 2).map((p) => p.video_id))
      .toEqual(['a', 'm']);
    expect(selectCatalogSlice([v('z', 3, null), v('a', 4, null)], 2).map((p) => p.video_id))
      .toEqual(['a', 'z']);
  });

  it('rotates: videos read tonight sort to the back of tomorrow night', () => {
    const pool = [v('a', 3, '2025-07-22'), v('b', 3, '2025-07-23'), v('c', 3, '2025-07-24')];
    const tonight = selectCatalogSlice(pool, 1);
    expect(tonight.map((p) => p.video_id)).toEqual(['a']);
    const after = pool.map((p) => (p.video_id === 'a' ? { ...p, last_tracked: '2026-09-04' } : p));
    expect(selectCatalogSlice(after, 1).map((p) => p.video_id)).toEqual(['b']);
  });

  it('the candidate query carries the tier floor and the oldest-read ordering', () => {
    expect(CATALOG_CANDIDATES_SQL).toContain('p.priority_tier >= $1');
    expect(CATALOG_CANDIDATES_SQL).toContain('order by p.last_tracked asc nulls last');
  });
});

describe('catalog rotation dates', () => {
  it('sizes the cycle from the pool, so 678K archive rows at 15K/night is ~45 nights', () => {
    expect(catalogCycleDays(678_242, 15_000)).toBe(46);
    expect(catalogCycleDays(1_000, 15_000)).toBe(1);
    expect(catalogCycleDays(0, 15_000)).toBe(1);
  });

  it('clamps the cycle so nothing is parked past the ceiling, or by a zero slice', () => {
    expect(catalogCycleDays(10_000_000, 1)).toBe(CATALOG_MAX_CYCLE_DAYS);
    expect(catalogCycleDays(100, 0)).toBe(CATALOG_MAX_CYCLE_DAYS);
  });

  // tier 3 is daily in DENSE MODE, so nextTrackDate would re-queue it tomorrow and the
  // round-robin would never advance. The catalogue parks a video one full rotation out.
  it('parks a read catalogue video a full rotation out, not on the tier cadence', () => {
    expect(catalogNextTrackDate('2026-09-03', 46)).toBe('2026-10-19');
    expect(nextTrackDate(3, '2026-09-03')).toBe('2026-09-04');
    expect(catalogNextTrackDate('2026-09-03', 0)).toBe('2026-09-04');
  });
});

describe('egress guard: nightly path must not use the metered Supabase REST API', () => {
  const nightlyFiles = [
    'lib/nightly/tracking-core.ts',
    'scripts/nightly-view-tracking.ts',
    'scripts/nightly-ingest.ts',
    'scripts/rss-poll.ts',
    'scripts/rss-retention.ts',
    'lib/rss/poll-policy.ts',
    'lib/rss/retention.ts',
    'scripts/score-videos.ts',
  ];
  it.each(nightlyFiles)('%s does not import supabase-js or call the REST endpoint', (rel) => {
    const src = fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
    expect(src).not.toMatch(/@supabase\/supabase-js/);
    expect(src).not.toMatch(/\.supabase\.co\/rest/);
    expect(src).not.toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(src).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});
