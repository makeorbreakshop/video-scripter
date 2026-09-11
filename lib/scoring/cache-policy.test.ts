import { loadRecords, ObservationCacheMissError } from './prior-load';

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

