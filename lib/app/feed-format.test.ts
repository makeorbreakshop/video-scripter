import {
  relativeTime, sincePublish, formatScore, isHighScore, compactNumber,
  feedRowView, toggleType, feedQuery, parseFeedParams, HIGH_SCORE_AT, FILTER_CHIPS,
} from './feed-format';

const NOW = new Date('2026-09-02T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const event = (over: Partial<any> = {}) => ({
  id: '1', type: 'upload', at: ago(3600_000), channel_id: 'UC1', channel_name: 'Chan',
  video_id: 'vid00000001', video_title: 'A title', thumbnail_url: 'https://t/x.jpg',
  published_at: ago(7200_000), payload: {}, ...over,
});

describe('relativeTime', () => {
  it('collapses to the largest unit that fits', () => {
    expect(relativeTime(ago(10_000), NOW)).toBe('now');
    expect(relativeTime(ago(5 * 60_000), NOW)).toBe('5m');
    expect(relativeTime(ago(3 * 3600_000), NOW)).toBe('3h');
    expect(relativeTime(ago(2 * 86400_000), NOW)).toBe('2d');
    expect(relativeTime(ago(20 * 86400_000), NOW)).toBe('2w');
  });
  it('falls back to a date past a year, and never renders a negative age', () => {
    expect(relativeTime(ago(400 * 86400_000), NOW)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(relativeTime(new Date(NOW.getTime() + 60_000), NOW)).toBe('now');
  });
  it('is empty for unparseable input rather than "NaN"', () => {
    expect(relativeTime('not a date', NOW)).toBe('');
  });
});

describe('sincePublish', () => {
  it('uses minutes under an hour and days past two', () => {
    expect(sincePublish(0.5)).toBe('30m after publish');
    expect(sincePublish(6)).toBe('6h after publish');
    expect(sincePublish(72)).toBe('3d after publish');
    expect(sincePublish(null)).toBeNull();
  });
});

describe('formatScore', () => {
  it('shows one decimal under 10x and whole numbers above', () => {
    expect(formatScore(2.34)).toBe('2.3x');
    expect(formatScore(12.6)).toBe('13x');
    expect(formatScore(null)).toBe('—');
  });
  it('flags a high score at the documented threshold', () => {
    expect(isHighScore(HIGH_SCORE_AT)).toBe(true);
    expect(isHighScore(HIGH_SCORE_AT - 0.01)).toBe(false);
    expect(isHighScore(null)).toBe(false);
  });
});

describe('compactNumber', () => {
  it('abbreviates by magnitude', () => {
    expect(compactNumber(842)).toBe('842');
    expect(compactNumber(4200)).toBe('4.2K');
    expect(compactNumber(42_000)).toBe('42K');
    expect(compactNumber(1_240_000)).toBe('1.2M');
    expect(compactNumber(null)).toBe('—');
  });
});

describe('feedRowView', () => {
  it('renders an upload with the single stored thumbnail', () => {
    const v = feedRowView(event());
    expect(v.label).toBe('UPLOAD');
    expect(v.headline).toBe('A title');
    expect(v.thumbs).toHaveLength(1);
    expect(v.href).toBe('/app/videos/vid00000001');
  });

  it('puts before and after thumbnails side by side on a swap', () => {
    const v = feedRowView(event({
      type: 'thumbnail_change',
      payload: { version: 2, before_url: 'https://t/1.jpg', after_url: 'https://t/2.jpg', hours_since_publish: 5 },
    }));
    expect(v.thumbs.map((t) => t.caption)).toEqual(['before', 'after']);
    expect(v.detail).toBe('New thumbnail (v2) · 5h after publish');
  });

  it('names an A/B rotation as a return to an earlier image', () => {
    const v = feedRowView(event({ type: 'ab_rotation', payload: { version: 3, before_url: 'a', after_url: 'b' } }));
    expect(v.label).toBe('A/B TEST');
    expect(v.detail).toContain('Rotated back');
  });

  it('leads a title change with the new title and keeps the old one as detail', () => {
    const v = feedRowView(event({ type: 'title_change', payload: { version: 2, old_title: 'Old', new_title: 'New' } }));
    expect(v.headline).toBe('New');
    expect(v.detail).toBe('was "Old"');
  });

  it('carries the score and high-score flag on an outlier', () => {
    const v = feedRowView(event({ type: 'outlier', payload: { score: 4.2, est30: 1_200_000, baseline: 300000 } }));
    expect(v.score).toBe(4.2);
    expect(v.highScore).toBe(true);
    expect(v.detail).toBe('1.2M est. 30-day views · baseline 300K');
  });

  it('survives an unknown type and an empty payload', () => {
    const v = feedRowView(event({ type: 'something_new', payload: null as any, video_title: null }));
    expect(v.label).toBe('SOMETHING NEW');
    expect(v.headline).toBe('Untitled video');
  });
});

describe('filters', () => {
  it('offers a chip per known type', () => {
    expect(FILTER_CHIPS.map((c) => c.type)).toContain('outlier');
  });
  it('toggles a type on and off in canonical order', () => {
    const a = toggleType([], 'title_change');
    const b = toggleType(a, 'upload');
    expect(b).toEqual(['upload', 'title_change']);
    expect(toggleType(b, 'upload')).toEqual(['title_change']);
  });
  it('ignores types the feed does not know', () => {
    expect(toggleType([], 'nonsense')).toEqual([]);
  });
});

describe('feedQuery / parseFeedParams round trip', () => {
  it('omits an all-types filter and an empty cursor', () => {
    expect(feedQuery({})).toBe('');
    expect(feedQuery({ types: ['upload', 'thumbnail_change', 'ab_rotation', 'title_change', 'outlier'] })).toBe('');
  });
  it('round trips a cursor and a partial type filter', () => {
    const qs = feedQuery({ cursor: 'abc', limit: 30, types: ['outlier', 'upload'] });
    const parsed = parseFeedParams(new URLSearchParams(qs));
    expect(parsed.cursor).toBe('abc');
    expect(parsed.limit).toBe(30);
    expect(new Set(parsed.types!)).toEqual(new Set(['outlier', 'upload']));
  });
  it('defaults the limit and drops junk types', () => {
    const parsed = parseFeedParams(new URLSearchParams('types=nope,upload&limit=-4'));
    expect(parsed.limit).toBe(25);
    expect(parsed.types).toEqual(['upload']);
  });
});
