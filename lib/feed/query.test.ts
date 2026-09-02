import { encodeCursor, decodeCursor, clampLimit, normalizeTypes, DEFAULT_LIMIT, MAX_LIMIT } from './query';

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
