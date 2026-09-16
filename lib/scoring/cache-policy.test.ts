import {
  loadCachedRecords,
  loadRecords,
  ObservationCacheMissError,
  partitionTargetsByCacheDependencies,
} from './prior-load';
import { OBS_CACHE_SERIES_READ_SQL, OBS_CACHE_V2_UPSERT_SQL } from './obs-cache';
import { encodeObservationState, type ObservationState } from './observation-state';

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

test('a cache-only batch preserves healthy records while reporting every miss', async () => {
  const state: ObservationState = {
    v: 2,
    videoId: 'healthy',
    publishedAt: '2026-01-01T00:00:00.000Z',
    lastChangeId: 1,
    points: [{ source: 'sample', at: '2026-01-02T00:00:00.000Z', views: 100,
      modelEligible: true, conflicted: false }],
  };
  const q = jest.fn(async () => [{
    video_id: 'healthy', obs: encodeObservationState(state), format: 2, last_change_id: 1,
    day30_views: null,
  }]);

  const result = await loadCachedRecords(q, ['healthy', 'missing'], { requireFormat2: true });

  expect(result.records.get('healthy')).toHaveLength(1);
  expect(result.missingIds).toEqual(['missing']);
  expect(q).toHaveBeenCalledTimes(1);
});

test('one missing prior blocks only targets that depend on it', () => {
  const targets = [{ id: 'blocked' }, { id: 'ready' }];
  const priorsOf = new Map([
    ['blocked', [{ id: 'missing-prior', pub: 1, ageDays: 1 }]],
    ['ready', [{ id: 'healthy-prior', pub: 1, ageDays: 1 }]],
  ]);
  const targetRecords = new Map([
    ['blocked', [{ day: 1, views: 10 }]],
    ['ready', [{ day: 1, views: 20 }]],
  ]);
  const priorRecords = new Map([['healthy-prior', [{ day: 1, views: 5 }]]]);

  const result = partitionTargetsByCacheDependencies(targets, priorsOf, targetRecords, priorRecords);

  expect(result.ready).toEqual([{ id: 'ready' }]);
  expect(result.blocked).toEqual([{ id: 'blocked' }]);
  expect(result.missingIds).toEqual(['missing-prior']);
});

test('a cache-only scorer receives exact day-30 truth with the state it already fetched', async () => {
  const state: ObservationState = {
    v: 2,
    videoId: 'prior',
    publishedAt: '2026-01-01T00:00:00.000Z',
    lastChangeId: 7,
    points: [
      { source: 'snapshot', at: '2026-01-30T12:00:00.000Z', views: 100,
        modelEligible: true, conflicted: false },
      { source: 'sample', at: '2026-01-31T00:00:00.000Z', views: 999,
        modelEligible: true, conflicted: false },
      { source: 'snapshot', at: '2026-02-01T12:00:00.000Z', views: 200,
        modelEligible: true, conflicted: false },
    ],
  };
  const stateSink = new Map<string, ObservationState>();
  const day30Sink = new Map<string, number>();
  const q = jest.fn(async () => [{
    video_id: 'prior', obs: encodeObservationState(state), format: 2, last_change_id: 7,
    day30_views: 100,
  }]);

  await loadRecords(q, ['prior'], {
    rawMissBudget: 0, requireFormat2: true, stateSink, day30Sink,
  });

  expect(q).toHaveBeenCalledTimes(1);
  expect(stateSink.get('prior')).toEqual(state);
  expect(day30Sink).toEqual(new Map([['prior', 100]]));
});
