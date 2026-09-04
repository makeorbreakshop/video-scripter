jest.mock('../admin/db', () => ({ q: jest.fn() }));
import { q } from '../admin/db';
import {
  encodeCursor, decodeCursor, clampLimit, normalizeTypes, DEFAULT_LIMIT, MAX_LIMIT, feedForChannels,
  scanShape, FLAT_SCAN_MIN_CHANNELS,
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

describe('scanShape', () => {
  it('probes per channel for a small tracked set, whatever the segment', () => {
    for (const types of [null, ['upload'], ['outlier'], ['ab_rotation']]) {
      expect(scanShape(1, types)).toBe('lateral');
      expect(scanShape(60, types)).toBe('lateral');
      expect(scanShape(FLAT_SCAN_MIN_CHANNELS - 1, types)).toBe('lateral');
    }
  });

  it('walks the global index for a large set with no segment filter', () => {
    expect(scanShape(FLAT_SCAN_MIN_CHANNELS, null)).toBe('flat');
    expect(scanShape(500, [])).toBe('flat');
  });

  it('walks the global index for a large set on a dense segment', () => {
    expect(scanShape(500, ['upload'])).toBe('flat');
  });

  it('keeps the per-channel probes for a large set on a sparse segment', () => {
    // A rare type is exactly where the global walk has to read tens of thousands of entries
    // it then throws away; the per-channel probe reads what the channel actually has.
    expect(scanShape(500, ['outlier'])).toBe('lateral');
    expect(scanShape(500, ['ab_rotation', 'thumbnail_change'])).toBe('lateral');
    expect(scanShape(500, ['title_change', 'thumbnail_change', 'ab_rotation'])).toBe('lateral');
  });

  it('treats a mixed segment containing a dense type as dense', () => {
    expect(scanShape(500, ['outlier', 'upload'])).toBe('flat');
  });

  it('never asks the database for a shape at zero channels', () => {
    // feedForChannels short-circuits before it gets here, but the helper must still be total.
    expect(scanShape(0, null)).toBe('lateral');
  });
});

describe('feedForChannels scan shape', () => {
  const rowsFor = (n: number) => Array.from({ length: n }, (_, i) => ({
    id: String(100 - i), type: 'upload', at: `2026-09-0${(i % 9) + 1}T00:00:00.000Z`,
    channel_id: 'UC1', video_id: 'v', payload: {},
  }));
  beforeEach(() => (q as jest.Mock).mockReset());

  it('uses the per-channel lateral for a small set', async () => {
    (q as jest.Mock).mockResolvedValue(rowsFor(3));
    await feedForChannels(['a', 'b', 'c'], { limit: 60 });
    const sql = (q as jest.Mock).mock.calls[0][0] as string;
    expect(sql).toContain('cross join lateral');
    expect(sql).not.toMatch(/from feed_events e0/);
  });

  it('uses one global scan for a 500-channel set', async () => {
    (q as jest.Mock).mockResolvedValue(rowsFor(3));
    const ids = Array.from({ length: 500 }, (_, i) => `UC${i}`);
    await feedForChannels(ids, { limit: 60 });
    const sql = (q as jest.Mock).mock.calls[0][0] as string;
    expect(sql).toContain('from feed_events e0');
    expect(sql).not.toContain('cross join lateral');
  });

  it('keeps the keyset predicate and its parameters in both shapes', async () => {
    const cursor = encodeCursor({ at: '2026-09-02T12:00:00.000Z', id: '4821' });
    for (const n of [3, 500]) {
      (q as jest.Mock).mockReset();
      (q as jest.Mock).mockResolvedValue(rowsFor(3));
      const ids = Array.from({ length: n }, (_, i) => `UC${i}`);
      await feedForChannels(ids, { limit: 60, cursor, types: ['upload'] });
      const [sql, params] = (q as jest.Mock).mock.calls[0];
      expect(sql).toMatch(/\(\w+\.at, \w+\.id\) < \(\$3::timestamptz, \$4::bigint\)/);
      expect(sql).toContain('$5::text[]');
      expect(params).toEqual([ids, 61, '2026-09-02T12:00:00.000Z', '4821', ['upload']]);
    }
  });

  it('asks for exactly one row more than the page in both shapes', async () => {
    for (const n of [3, 500]) {
      (q as jest.Mock).mockReset();
      (q as jest.Mock).mockResolvedValue(rowsFor(61));
      const ids = Array.from({ length: n }, (_, i) => `UC${i}`);
      const page = await feedForChannels(ids, { limit: 60 });
      expect((q as jest.Mock).mock.calls[0][1][1]).toBe(61);
      expect(page.events).toHaveLength(60);
      expect(page.next_cursor).not.toBeNull();
    }
  });
});
