import fs from 'fs';
import path from 'path';
import { chunk, parseRssVideoIds } from './tracking-core';

// The scheduling tests that used to live here moved to due-core.test.ts with the logic: the
// 3 AM nightly (nextTrackDate, buildSnapshotRows, the catalogue slice) was retired on
// 2026-09-05 in favour of the per-video next_track_at queue.

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
describe('egress guard: nightly path must not use the metered Supabase REST API', () => {
  const nightlyFiles = [
    'lib/nightly/tracking-core.ts',
    'scripts/nightly-ingest.ts',
    'scripts/rss-poll.ts',
    'scripts/rss-retention.ts',
    'lib/rss/poll-policy.ts',
    'lib/nightly/due-core.ts',
    'scripts/track-due.ts',
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
