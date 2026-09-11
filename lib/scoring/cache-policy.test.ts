import { loadRecords, ObservationCacheMissError } from './prior-load';
import { OBS_CACHE_SERIES_READ_SQL, OBS_CACHE_V2_UPSERT_SQL } from './obs-cache';

test('a late materializer cannot regress a newer cache watermark', () => {
  expect(OBS_CACHE_V2_UPSERT_SQL)
    .toMatch(/where\s+video_obs_cache\.last_change_id\s*<=\s*excluded\.last_change_id/i);
});

test('the series cache read refuses a chunk before its payload crosses the remaining wire budget', () => {
  expect(OBS_CACHE_SERIES_READ_SQL).toMatch(/sum\(octet_length\(obs\)\)/i);
  expect(OBS_CACHE_SERIES_READ_SQL).toMatch(/total_cache_bytes\s*<=\s*\$2/i);
  expect(OBS_CACHE_SERIES_READ_SQL).toMatch(/null::bytea/i);
});

test('a zero raw-miss budget defers without querying any raw observation table', async () => {
  const queries: string[] = [];
  const q = jest.fn(async (sql: string) => {
    queries.push(sql);
    if (sql.includes('video_obs_cache')) return [];
    throw new Error('raw history must not be queried');
  });

  await expect(loadRecords(q, ['missing'], { rawMissBudget: 0 }))
    .rejects.toEqual(expect.objectContaining<Partial<ObservationCacheMissError>>({ missingIds: ['missing'] }));
  expect(queries).toHaveLength(1);
  expect(queries[0]).not.toMatch(/view_snapshots|view_samples|rss_samples/);
});

test('an explicit interactive budget permits only that many raw misses', async () => {
  const q = jest.fn(async (sql: string) => sql.includes('video_obs_cache') ? [] : []);
  await expect(loadRecords(q, ['a', 'b'], { rawMissBudget: 1 }))
    .rejects.toEqual(expect.objectContaining({ missingIds: ['a', 'b'] }));
  expect(q).toHaveBeenCalledTimes(1);
});
