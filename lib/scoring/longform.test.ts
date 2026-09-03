import { durationSeconds, isLongform, longformSql, SHORT_MAX_SECONDS } from './longform';

describe('durationSeconds', () => {
  test('parses ISO-8601 PT durations', () => {
    expect(durationSeconds('PT1M9S')).toBe(69);
    expect(durationSeconds('PT29M31S')).toBe(1771);
    expect(durationSeconds('PT3H1M23S')).toBe(10883);
    expect(durationSeconds('PT45S')).toBe(45);
    expect(durationSeconds('PT2M')).toBe(120);
  });
  test('handles day components and rejects live / missing / junk', () => {
    expect(durationSeconds('P1DT11H37M5S')).toBe(86400 + 11 * 3600 + 37 * 60 + 5);
    expect(durationSeconds('P0D')).toBeNull();
    expect(durationSeconds(null)).toBeNull();
    expect(durationSeconds('')).toBeNull();
    expect(durationSeconds('0')).toBeNull();
  });
});

describe('isLongform', () => {
  const checked = '2026-09-03T14:00:00Z';
  test('a flagged Short is never long-form, checked or not', () => {
    expect(isLongform({ is_short: true, duration: 'PT29M', shorts_checked_at: checked })).toBe(false);
    expect(isLongform({ is_short: true, duration: 'PT1M9S', shorts_checked_at: null })).toBe(false);
  });
  test('live placeholders are never long-form', () => {
    expect(isLongform({ is_short: false, duration: 'P0D', shorts_checked_at: checked })).toBe(false);
    expect(isLongform({ is_short: false, duration: null })).toBe(false);
  });
  test('an UNCHECKED clip of 180s or less is treated as a Short (Matt Wolfe 69s clips flagged false)', () => {
    expect(isLongform({ is_short: false, duration: 'PT1M9S', shorts_checked_at: null })).toBe(false);
    expect(isLongform({ is_short: false, duration: 'PT3M', shorts_checked_at: null })).toBe(false);
    expect(isLongform({ is_short: null, duration: 'PT2M48S' })).toBe(false);
  });
  test('a CHECKED clip of 180s or less that YouTube says is not a Short is long-form', () => {
    expect(isLongform({ is_short: false, duration: 'PT2M48S', shorts_checked_at: checked })).toBe(true);
  });
  test('anything over 180s is long-form without a check', () => {
    expect(isLongform({ is_short: false, duration: 'PT3M1S', shorts_checked_at: null })).toBe(true);
    expect(isLongform({ is_short: false, duration: 'PT29M31S' })).toBe(true);
    expect(isLongform({ is_short: false, duration: 'PT3H1M23S' })).toBe(true);
  });
  test('the boundary is exactly SHORT_MAX_SECONDS', () => {
    expect(SHORT_MAX_SECONDS).toBe(180);
  });
});

describe('longformSql', () => {
  test('carries all three clauses and the alias', () => {
    const sql = longformSql('p');
    expect(sql).toContain("coalesce(p.is_short, false) = false");
    expect(sql).toContain("coalesce(p.duration, '') <> 'P0D'");
    expect(sql).toContain('p.shorts_checked_at is null');
    expect(sql).toContain(`<= ${SHORT_MAX_SECONDS}`);
    expect(sql).not.toContain('v.');
  });
  test('defaults the alias to v and is parenthesised so it can follow an AND', () => {
    const sql = longformSql();
    expect(sql.trim().startsWith('(')).toBe(true);
    expect(sql.trim().endsWith(')')).toBe(true);
    expect(sql).toContain('v.is_short');
  });
  test('only casts durations that Postgres can parse as an interval', () => {
    // A '0' or free-text duration must not reach ::interval, or the whole query throws.
    expect(longformSql()).toContain(`~ '^PT[0-9HMS]+$'`);
  });
});
