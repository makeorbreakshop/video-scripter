import { packagingVideoIds, testRowsForEvents } from './feed-tests';
import type { FeedEventLike } from './feed-format';
import type { ThumbRowWithUrl } from './test-row';

const T = (h: number, m = 0) => new Date(Date.UTC(2026, 8, 3, h, m)).toISOString();
const th = (version: number, sha: string, first_seen: string): ThumbRowWithUrl =>
  ({ version, sha256: sha, phash: null, first_seen, url: `/t/${version}.jpg` });

const ev = (over: Partial<FeedEventLike>): FeedEventLike => ({
  id: '1', type: 'ab_rotation', at: T(15), channel_id: 'UC1', channel_name: 'Steve Mould',
  video_id: 'k3Q', video_title: 'Ram pump', thumbnail_url: null,
  published_at: new Date(Date.UTC(2026, 7, 31, 16)).toISOString(), payload: {}, score: 1.4, ...over,
});

describe('packagingVideoIds', () => {
  it('names only the videos whose thumbnails moved', () => {
    const events = [ev({}), ev({ id: '2', type: 'upload', video_id: 'up' }), ev({ id: '3', type: 'title_change', video_id: 'ti' }),
                    ev({ id: '4', type: 'thumbnail_change', video_id: 'sw' })];
    expect(packagingVideoIds(events).sort()).toEqual(['k3Q', 'sw']);
  });
  it('de-duplicates a burst on one video', () => {
    expect(packagingVideoIds([ev({ id: '1' }), ev({ id: '2', at: T(16) })])).toEqual(['k3Q']);
  });
});

describe('testRowsForEvents', () => {
  const thumbs = { k3Q: [th(2, 'ram', T(12)), th(3, 'fake', T(13, 40)), th(4, 'ram', T(15, 21))] };

  it('collapses a video\'s whole burst of rotations into one row', () => {
    const events = [ev({ id: '1', at: T(12) }), ev({ id: '2', at: T(13, 40) }), ev({ id: '3', at: T(15, 21) })];
    const rows = testRowsForEvents(events, thumbs, T(16));
    expect(Object.keys(rows)).toEqual(['k3Q']);
    expect(rows.k3Q.status).toBe('testing');
    expect(rows.k3Q.headline).toBe('2 thumbnails');
  });

  it('takes the title and score from the newest event for the video', () => {
    const events = [ev({ id: '1', at: T(12), video_title: 'old', score: 0.4 }),
                    ev({ id: '2', at: T(15, 21), video_title: 'new', score: 2.6 })];
    const rows = testRowsForEvents(events, thumbs, T(16));
    expect(rows.k3Q.title).toBe('new');
    expect(rows.k3Q.meta).toContain('2.6×');
  });

  it('skips a video we hold no version history for', () => {
    expect(testRowsForEvents([ev({})], {}, T(16))).toEqual({});
  });

  it('skips a video with a single image, so the feed keeps its ordinary card', () => {
    expect(testRowsForEvents([ev({})], { k3Q: [th(1, 'a', T(9))] }, T(16))).toEqual({});
  });

  it('ignores uploads, titles and outliers', () => {
    const events = [ev({ type: 'upload' }), ev({ type: 'title_change' }), ev({ type: 'outlier' })];
    expect(testRowsForEvents(events, thumbs, T(16))).toEqual({});
  });
});
