import {
  markSeriesDirty, seriesDirtyWrite, SERIES_DIRTY_MARK_SQL, SERIES_DIRTY_CLAIM_SQL,
  SERIES_DIRTY_CLEAR_SQL, seriesReads, noteSeriesRead, seriesFallbackRate,
} from './series-store';

const client = (fail?: (sql: string) => boolean) => {
  const calls: string[] = [];
  return {
    calls,
    query: jest.fn(async (sql: string, _values?: any[]) => {
      calls.push(sql.trim().split('\n')[0]);
      if (fail?.(sql)) throw new Error('relation "series_dirty" does not exist');
      return { rowCount: 1, rows: [] };
    }),
  };
};

describe('markSeriesDirty', () => {
  test('one statement however many videos', async () => {
    const c = client();
    expect(await markSeriesDirty(c, Array.from({ length: 5000 }, (_, i) => `v${i}`))).toBe(5000);
    expect(c.query).toHaveBeenCalledTimes(1);
    expect((c.query.mock.calls[0] as any[])[1][0]).toHaveLength(5000);
  });

  test('deduplicates and drops empties', async () => {
    const c = client();
    expect(await markSeriesDirty(c, ['a', 'a', '', 'b'])).toBe(2);
    expect(await markSeriesDirty(c, [])).toBe(0);
    expect(c.query).toHaveBeenCalledTimes(1);
  });

  test('a failing mark never throws at the ingestion path', async () => {
    const c = client((sql) => sql.includes('series_dirty'));
    await expect(markSeriesDirty(c, ['a'])).resolves.toBe(0);
  });

  // The one that matters: in Postgres any failed statement aborts the transaction, so an
  // unprotected mark would turn the caller's commit into a rollback and lose the readings.
  test('inside a transaction a failing mark is contained by a savepoint', async () => {
    const c = client((sql) => sql.includes('series_dirty (video_id'));
    expect(await markSeriesDirty(c, ['a'], { transactional: true })).toBe(0);
    expect(c.calls).toContain('savepoint series_dirty_mark');
    expect(c.calls).toContain('rollback to savepoint series_dirty_mark');
  });

  test('a successful transactional mark releases its savepoint', async () => {
    const c = client();
    expect(await markSeriesDirty(c, ['a'], { transactional: true })).toBe(1);
    expect(c.calls).toEqual(['savepoint series_dirty_mark', expect.stringContaining('insert into series_dirty'), 'release savepoint series_dirty_mark']);
  });

  test('outside a transaction the savepoint form gives up rather than risking the write', async () => {
    const c = client((sql) => sql.startsWith('savepoint'));
    expect(await markSeriesDirty(c, ['a'], { transactional: true })).toBe(0);
    expect(c.query).toHaveBeenCalledTimes(1);
  });
});

describe('seriesDirtyWrite', () => {
  test('is the same statement the direct path uses', () => {
    expect(seriesDirtyWrite(['a', 'b'])!.sql).toBe(SERIES_DIRTY_MARK_SQL);
    expect(seriesDirtyWrite(['a', 'b'])!.params).toEqual([['a', 'b']]);
  });
  test('nothing to mark is null, not an empty statement', () => {
    expect(seriesDirtyWrite([])).toBeNull();
    expect(seriesDirtyWrite([''])).toBeNull();
  });
});

describe('watermark-safe series queue', () => {
  test('a repeated mark advances its generation instead of disappearing', () => {
    expect(SERIES_DIRTY_MARK_SQL).toMatch(/on conflict[^]*do update/i);
    expect(SERIES_DIRTY_MARK_SQL).toContain('generation');
  });

  test('claims and clears the exact generation so a concurrent mark survives', () => {
    expect(SERIES_DIRTY_CLAIM_SQL).toContain('generation');
    expect(SERIES_DIRTY_CLEAR_SQL).toMatch(/generation\s*=\s*x\.generation/i);
  });
});

describe('the fallback counter', () => {
  test('counts hits and misses so the fallback rate is a number, not a feeling', () => {
    seriesReads.hits = 0; seriesReads.misses = 0;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    noteSeriesRead('a', {} as any);
    noteSeriesRead('b', null);
    noteSeriesRead('c', {} as any);
    expect(seriesFallbackRate()).toBeCloseTo(1 / 3);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
