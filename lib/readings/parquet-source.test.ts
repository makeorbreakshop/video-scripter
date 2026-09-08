import { substitute, toDuckDialect, quoteAt, PARQUET_DEFAULTS } from './parquet-source';
import { longformSql } from '../scoring/longform';
import { OBSERVATION_RECORDS_SQL } from '../scoring/observations';

describe('substitute', () => {
  test('quotes strings and cannot be ended by one', () => {
    expect(substitute('select $1', ["it's"])).toBe("select 'it''s'");
  });
  test('numbers, booleans and nulls are literals, not strings', () => {
    expect(substitute('select $1, $2, $3', [3, true, null])).toBe('select 3, true, null');
  });
  test('an array becomes a duckdb list', () => {
    expect(substitute('select $1', [['a', 'b']])).toBe("select ['a', 'b']");
  });
  test('$10 is not eaten by $1', () => {
    const params = Array.from({ length: 10 }, (_, i) => i + 1);
    expect(substitute('select $10, $1', params)).toBe('select 10, 1');
  });
  test('dates keep their instant', () => {
    expect(substitute('select $1', [new Date('2026-09-08T00:00:00Z')])).toBe("select timestamp '2026-09-08T00:00:00.000Z'");
  });
});

describe('quoteAt', () => {
  // `at` is reserved in DuckDB (AT TIME ZONE), and an unqualified `at` in a select list is a
  // parse error — which is the shape of OBSERVATION_RECORDS_SQL and half the harness queries.
  test('quotes a bare at', () => {
    expect(quoteAt('select video_id, at, views from rss_samples')).toBe('select video_id, "at", views from rss_samples');
  });
  test('leaves a qualified or already-quoted one alone', () => {
    expect(quoteAt('select x.at, "at" from t x')).toBe('select x.at, "at" from t x');
  });
  test('does not touch a column that merely ends in at', () => {
    expect(quoteAt('select received_at, created_at from t')).toBe('select received_at, created_at from t');
  });
  test('leaves AT TIME ZONE alone', () => {
    expect(quoteAt("select a at time zone 'UTC' from t")).toBe("select a at time zone 'UTC' from t");
  });
  test('does not rewrite inside a string literal', () => {
    expect(quoteAt("select 'look at this' as x, at from t")).toBe(`select 'look at this' as x, "at" from t`);
  });
});

describe('toDuckDialect', () => {
  test('= any(list) becomes in (select unnest(list))', () => {
    expect(toDuckDialect(substitute('where id = any($1::text[])', [['a']])))
      .toContain("in (select unnest(['a']))");
  });
  test('collate "C" is dropped — duckdb is byte-wise already', () => {
    expect(toDuckDialect('order by video_id collate "C"')).toBe('order by video_id ');
  });
  // The longform rule has ONE definition (lib/scoring/longform.ts). DuckDB has neither
  // duration::interval nor ~, so the export precomputes it and the predicate is rewritten to
  // read the precomputed column — the same rule, not a second one.
  test('the longform predicate is rewritten to the precomputed column', () => {
    expect(toDuckDialect(`select 1 from videos v where ${longformSql('v')}`))
      .toBe('select 1 from videos v where (v.is_longform)');
    expect(toDuckDialect(`select 1 from videos a where ${longformSql('a')}`))
      .toContain('(a.is_longform)');
  });
  test('the real observation-records query survives translation', () => {
    const out = toDuckDialect(substitute(OBSERVATION_RECORDS_SQL, [['abc']]));
    expect(out).not.toMatch(/= any\(/);
    expect(out).toContain('"at"');
    expect(out).toContain("in (select unnest(['abc']))");
  });
});

describe('the memory ceiling', () => {
  // An analytics engine given a whole machine will take it. These defaults are the ceiling a
  // caller has to deliberately raise, not a suggestion.
  test('is small, and spills rather than growing', () => {
    expect(PARQUET_DEFAULTS.memoryLimit).toBe('2GB');
    expect(PARQUET_DEFAULTS.threads).toBeLessThanOrEqual(4);
    expect(PARQUET_DEFAULTS.tempLimit).toBeTruthy();
  });
});
