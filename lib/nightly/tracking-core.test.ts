import {
  nextTrackDate,
  buildSnapshotRows,
  chunk,
  parseRssVideoIds,
} from './tracking-core';
import fs from 'fs';
import path from 'path';

describe('nextTrackDate', () => {
  const today = '2026-08-31';
  it('schedules by tier interval', () => {
    expect(nextTrackDate(0, today)).toBe('2026-09-01'); // 12h -> next day at daily granularity
    expect(nextTrackDate(1, today)).toBe('2026-09-01');
    expect(nextTrackDate(2, today)).toBe('2026-09-03');
    expect(nextTrackDate(3, today)).toBe('2026-09-07');
    expect(nextTrackDate(4, today)).toBe('2026-09-30');
  });
  it('treats unknown tiers as monthly', () => {
    expect(nextTrackDate(99, today)).toBe('2026-09-30');
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
    expect(b.next_track_date).toBe('2026-09-07'); // tier 3 -> weekly, per-video not per-batch
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

describe('egress guard: nightly path must not use the metered Supabase REST API', () => {
  const nightlyFiles = [
    'lib/nightly/tracking-core.ts',
    'scripts/nightly-view-tracking.ts',
    'scripts/nightly-ingest.ts',
  ];
  it.each(nightlyFiles)('%s does not import supabase-js or call the REST endpoint', (rel) => {
    const src = fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
    expect(src).not.toMatch(/@supabase\/supabase-js/);
    expect(src).not.toMatch(/\.supabase\.co\/rest/);
    expect(src).not.toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(src).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});
