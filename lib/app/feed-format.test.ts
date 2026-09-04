import {
  relativeTime, sincePublish, formatScore, isHighScore, compactNumber,
  feedRowView, toggleType, feedQuery, parseFeedParams, HIGH_SCORE_AT, FILTER_CHIPS, groupCards,
  FEED_SEGMENTS, parseSegment, segmentTypes, type FeedEventLike } from './feed-format';
import { FEED_TYPES } from '../feed/event-types';

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
    expect(sincePublish(24 * 120)).toBe('4mo after publish');
    expect(sincePublish(24 * 601)).toBe('1.6y after publish');
    expect(sincePublish(24 * 365)).toBe('1y after publish');
    expect(sincePublish(null)).toBeNull();
  });
});

describe('formatScore', () => {
  it('shows one decimal under 10x and whole numbers above', () => {
    expect(formatScore(2.34)).toBe('2.3×');
    expect(formatScore(12.6)).toBe('13×');
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
    expect(v.label).toBeNull(); // the thumbnail, channel and time already say "upload"
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

describe('feed timestamps and day grouping', () => {
  const { etTimestamp, etDayKey, dayDividerLabel, groupByDay } = require('./feed-format');

  it('renders the event time absolutely, in ET', () => {
    // 2026-08-29T17:57:00Z is 1:57 PM in New York (EDT).
    expect(etTimestamp('2026-08-29T17:57:00.000Z')).toBe('Aug 29 · 1:57 PM ET');
  });
  it('is empty rather than "Invalid Date" for junk', () => {
    expect(etTimestamp(null)).toBe('');
    expect(etTimestamp('not a date')).toBe('');
    expect(etDayKey(undefined)).toBe('');
  });
  it('keys a late-evening ET event to the ET day, not the UTC one', () => {
    // 2026-08-30T02:30:00Z is still Aug 29 in New York.
    expect(etDayKey('2026-08-30T02:30:00.000Z')).toBe('2026-08-29');
  });

  const NOW = new Date('2026-09-02T16:00:00.000Z'); // Sep 2 in ET
  it('names today and yesterday, and dates everything else', () => {
    expect(dayDividerLabel('2026-09-02T15:00:00.000Z', NOW)).toBe('Today');
    expect(dayDividerLabel('2026-09-01T15:00:00.000Z', NOW)).toBe('Yesterday');
    expect(dayDividerLabel('2026-08-30T15:00:00.000Z', NOW)).toMatch(/Aug 30/);
    expect(dayDividerLabel('2025-08-30T15:00:00.000Z', NOW)).toMatch(/2025/);
  });

  it('groups contiguous runs of the same ET day, keeping order', () => {
    const g = groupByDay([
      { at: '2026-09-02T15:00:00.000Z' },
      { at: '2026-09-02T12:00:00.000Z' },
      { at: '2026-09-01T12:00:00.000Z' },
    ]);
    expect(g.map((d: any) => [d.key, d.events.length])).toEqual([
      ['2026-09-02', 2], ['2026-09-01', 1],
    ]);
  });
  it('handles an empty page', () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe('upload rows do not say the same thing twice', () => {
  const { feedRowView } = require('./feed-format');
  const ev = (o: any = {}) => ({
    id: '1', type: 'upload', at: '2026-08-29T17:57:00.000Z', channel_id: 'UC1', channel_name: 'MOBS',
    video_id: 'v1', video_title: 'A title', thumbnail_url: 'https://t/1.jpg', published_at: null, payload: {}, ...o,
  });
  it('drops the type tag and the "New upload" line, and goes large', () => {
    const v = feedRowView(ev());
    expect(v.label).toBeNull();
    expect(v.detail).toBeNull();
    expect(v.thumbSize).toBe('large');
  });
  it('keeps a tag for events whose kind is not obvious', () => {
    expect(feedRowView(ev({ type: 'thumbnail_change', payload: { version: 2 } })).label).toBe('THUMB SWAP');
    expect(feedRowView(ev({ type: 'thumbnail_change', payload: { version: 2 } })).thumbSize).toBe('small');
  });
});

describe('groupCards', () => {
  const ev = (o: Partial<FeedEventLike>): FeedEventLike => ({ id: Math.random().toString(36).slice(2), type: 'upload', at: '2026-09-01T16:00:00.000Z', channel_id: 'c', channel_name: 'C', video_id: 'v', video_title: 'T', thumbnail_url: 'u', published_at: null, payload: {}, ...o });
  it('collapses a burst of thumbnail events on one video into one card with the versions in order', () => {
    const days = groupCards([
      ev({ type: 'ab_rotation', at: '2026-09-01T20:19:00.000Z', payload: { after_url: 'v6', version: 6 } }),
      ev({ type: 'thumbnail_change', at: '2026-09-01T19:20:00.000Z', payload: { after_url: 'v2', version: 2 } }),
      ev({ type: 'upload', at: '2026-09-01T16:00:00.000Z' }),
    ]);
    expect(days).toHaveLength(1);
    expect(days[0].cards).toHaveLength(1);
    const c = days[0].cards[0];
    expect(c.uploadedAt).toBe('2026-09-01T16:00:00.000Z');
    expect(c.thumbSwaps.map((t) => t.version)).toEqual([2, 6]);
    expect(c.at).toBe('2026-09-01T20:19:00.000Z');
  });
  it('a change on another day is a separate card', () => {
    const days = groupCards([
      ev({ type: 'thumbnail_change', at: '2026-09-09T15:00:00.000Z', payload: { after_url: 'v7', version: 7 } }),
      ev({ type: 'upload', at: '2026-09-01T16:00:00.000Z' }),
    ]);
    expect(days.map((d) => d.cards.length)).toEqual([1, 1]);
  });
});

describe('card kind, verb and meta', () => {
  const { cardKind, cardVerb, ordinal, cardMeta } = require('./feed-format');
  const ev = (o: Partial<FeedEventLike>): FeedEventLike => ({ id: Math.random().toString(36).slice(2), type: 'upload', at: '2026-09-01T16:00:00.000Z', channel_id: 'c', channel_name: 'C', video_id: 'v', video_title: 'T', thumbnail_url: 'u', published_at: null, payload: {}, ...o });
  const card = (events: FeedEventLike[]) => groupCards(events)[0].cards[0];

  it('an upload wins the verb even when the day also holds edits', () => {
    const c = card([
      ev({ type: 'title_change', at: '2026-09-01T18:00:00.000Z', payload: { old_title: 'A', new_title: 'B', version: 2 } }),
      ev({ type: 'upload' }),
    ]);
    expect(cardKind(c)).toBe('upload');
    expect(cardVerb(c)).toBe('posted a new video');
  });

  it('names a title-only day', () => {
    const c = card([ev({ type: 'title_change', payload: { old_title: 'A', new_title: 'B', version: 2, hours_since_publish: 72 } })]);
    expect(cardKind(c)).toBe('title');
    expect(cardVerb(c)).toBe('changed the title');
    expect(cardMeta(c)).toBe('2nd title · 3d after publish');
  });

  it('counts thumbnails, and calls a rotation an A/B test', () => {
    const one = card([ev({ type: 'thumbnail_change', payload: { after_url: 'x', version: 3, hours_since_publish: 24 } })]);
    expect(cardKind(one)).toBe('thumb');
    expect(cardVerb(one)).toBe('swapped the thumbnail');
    expect(cardMeta(one)).toBe('3rd thumbnail · 24h after publish');

    const many = card([
      ev({ type: 'thumbnail_change', at: '2026-09-01T17:00:00.000Z', payload: { after_url: 'x', version: 2, hours_since_publish: 24 } }),
      ev({ type: 'ab_rotation', at: '2026-09-01T18:00:00.000Z', payload: { after_url: 'y', version: 3, hours_since_publish: 48 } }),
      ev({ type: 'ab_rotation', at: '2026-09-01T19:00:00.000Z', payload: { after_url: 'z', version: 4, hours_since_publish: 48 } }),
    ]);
    expect(cardVerb(many)).toBe('rotated 3 thumbnails');
    // No 'A/B test' and no rotation count: the watcher saw images change, not an experiment.
    expect(cardMeta(many)).toBe('4th thumbnail · 2d after publish');
  });

  it('a same-day title and thumbnail change is one package', () => {
    const c = card([
      ev({ type: 'thumbnail_change', at: '2026-09-01T17:00:00.000Z', payload: { after_url: 'x', version: 3, hours_since_publish: 144 } }),
      ev({ type: 'title_change', at: '2026-09-01T17:05:00.000Z', payload: { old_title: 'A', new_title: 'B', version: 2, hours_since_publish: 144 } }),
    ]);
    expect(cardKind(c)).toBe('combo');
    expect(cardVerb(c)).toBe('changed the title and thumbnail');
    expect(cardMeta(c)).toBe('3rd package · 6d after publish');
  });

  it('a score on its own is an outlier card with no meta line', () => {
    const c = card([ev({ type: 'outlier', payload: { score: 4.2 } })]);
    expect(cardKind(c)).toBe('outlier');
    expect(cardVerb(c)).toBe('is beating its baseline');
    expect(cardMeta(c)).toBeNull();
  });

  it('ordinal handles the teens and rejects junk', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
    expect(ordinal(0)).toBeNull();
    expect(ordinal(null)).toBeNull();
  });
});

describe('feed segments', () => {
  it('falls back to all for anything it does not know', () => {
    expect(parseSegment('nope')).toBe('all');
    expect(parseSegment(undefined)).toBe('all');
    expect(parseSegment(['tests'])).toBe('tests');
  });
  it('maps each segment to the event types behind it', () => {
    expect(segmentTypes('all')).toBeNull();
    expect(segmentTypes('tests')).toEqual(['ab_rotation']);
    expect(segmentTypes('changes')).toEqual(['thumbnail_change', 'title_change']);
    expect(segmentTypes('uploads')).toEqual(['upload']);
    expect(segmentTypes('outliers')).toEqual(['outlier']);
  });
  it('only offers types the feed actually stores', () => {
    for (const s of FEED_SEGMENTS) {
      for (const t of segmentTypes(s.key) || []) expect(FEED_TYPES).toContain(t);
    }
  });
});
