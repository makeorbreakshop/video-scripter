jest.mock('../admin/db', () => ({ q: jest.fn() }));
import { q } from '../admin/db';
import {
  encodeCursor, decodeCursor, clampLimit, normalizeTypes, DEFAULT_LIMIT, MAX_LIMIT, feedForChannels,
} from './query';

describe('cursors', () => {
  it('round-trips', () => {
    const c = { at: '2026-09-02T12:00:00.000Z', id: '4821' };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it('is null for missing input', () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });

  it('rejects garbage rather than throwing at the caller', () => {
    expect(decodeCursor('not-base64-$$$')).toBeNull();
    expect(decodeCursor(Buffer.from('nope', 'utf8').toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from('2026-09-02T12:00:00Z|abc', 'utf8').toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from('never|12', 'utf8').toString('base64url'))).toBeNull();
  });

  it('survives an id-shaped separator in the timestamp half', () => {
    const c = { at: '2026-09-02T12:00:00.000Z', id: '7' };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });
});

describe('clampLimit', () => {
  it('defaults when absent or nonsense', () => {
    expect(clampLimit(undefined)).toBe(DEFAULT_LIMIT);
    expect(clampLimit(null)).toBe(DEFAULT_LIMIT);
    expect(clampLimit(0)).toBe(DEFAULT_LIMIT);
    expect(clampLimit(-5)).toBe(DEFAULT_LIMIT);
    expect(clampLimit(NaN)).toBe(DEFAULT_LIMIT);
  });

  it('caps and floors', () => {
    expect(clampLimit(10)).toBe(10);
    expect(clampLimit(10.9)).toBe(10);
    expect(clampLimit(9999)).toBe(MAX_LIMIT);
  });
});

describe('normalizeTypes', () => {
  it('is null for empty', () => {
    expect(normalizeTypes(null)).toBeNull();
    expect(normalizeTypes([])).toBeNull();
  });

  it('drops unknown types and dedupes', () => {
    expect(normalizeTypes(['upload', 'upload', 'nonsense'])).toEqual(['upload']);
  });

  it('returns null rather than an empty filter when nothing survives', () => {
    expect(normalizeTypes(['drop table feed_events'])).toBeNull();
  });

  it('trims whitespace from query-string values', () => {
    expect(normalizeTypes([' outlier ', 'ab_rotation'])).toEqual(['outlier', 'ab_rotation']);
  });
});

describe('feedForChannels SQL', () => {
  const mq = q as jest.Mock;
  beforeEach(() => { mq.mockReset(); mq.mockResolvedValue([]); });
  const sql = () => String(mq.mock.calls[0][0]).replace(/\s+/g, ' ');

  it('does not query at all for an empty channel list', async () => {
    await expect(feedForChannels([])).resolves.toEqual({ events: [], next_cursor: null });
    expect(mq).not.toHaveBeenCalled();
  });

  it('filters on the stored is_longform column, never a join to videos', async () => {
    await feedForChannels(['UC1']);
    expect(sql()).toContain('e2.is_longform');
    // videos is still joined for the display columns, but only after the LIMIT.
    expect(sql()).not.toMatch(/where[^)]*coalesce\(v\.is_short/);
  });

  it('reads each channel through its own ordered lateral so the page is a merge, not a scan', async () => {
    await feedForChannels(['UC1', 'UC2']);
    expect(sql()).toContain('cross join lateral');
    expect(sql()).toContain('e2.channel_id = c.channel_id');
    expect(mq.mock.calls[0][1][0]).toEqual(['UC1', 'UC2']);
  });

  it('pushes the cursor, type and since filters inside the lateral', async () => {
    await feedForChannels(['UC1'], {
      cursor: encodeCursor({ at: '2026-09-02T12:00:00.000Z', id: '99' }),
      types: ['upload'],
      since: '2026-09-01T00:00:00.000Z',
    });
    const text = sql();
    expect(text).toContain('(e2.at, e2.id) < ($3::timestamptz, $4::bigint)');
    expect(text).toContain('e2.type = any($5::text[])');
    expect(text).toContain('e2.at >= $6::timestamptz');
    expect(mq.mock.calls[0][1]).toEqual([['UC1'], 51, '2026-09-02T12:00:00.000Z', '99', ['upload'], '2026-09-01T00:00:00.000Z']);
  });

  it('numbers the type and since parameters from 3 when there is no cursor', async () => {
    await feedForChannels(['UC1'], { types: ['upload'], since: '2026-09-01T00:00:00.000Z' });
    expect(sql()).toContain('e2.type = any($3::text[])');
    expect(sql()).toContain('e2.at >= $4::timestamptz');
    expect(mq.mock.calls[0][1]).toEqual([['UC1'], 51, ['upload'], '2026-09-01T00:00:00.000Z']);
  });

  it('reports a next cursor only when the extra row came back', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ id: String(i + 1), at: '2026-09-02T12:00:00.000Z' }));
    mq.mockResolvedValue(rows);
    const page = await feedForChannels(['UC1'], { limit: 2 });
    expect(page.events).toHaveLength(2);
    expect(decodeCursor(page.next_cursor)).toEqual({ at: '2026-09-02T12:00:00.000Z', id: '2' });
    mq.mockResolvedValue(rows.slice(0, 2));
    expect((await feedForChannels(['UC1'], { limit: 2 })).next_cursor).toBeNull();
  });
});
