import { buildSeriesFile } from './series';
import { createHybridChartReader } from './hybrid-chart';

const at = '2026-09-18T12:00:00.000Z';
const oldAt = '2026-09-01T12:00:00.000Z';
const saved = (id = 'video') => buildSeriesFile({ videoId: id, publishedAt: oldAt, builtAt: oldAt,
  samples: [{ at: oldAt, views: 100 }, { at, views: 150 }] });
const latest = (id = 'video') => buildSeriesFile({ videoId: id, publishedAt: oldAt, builtAt: at,
  samples: [{ at, views: 200 }],
  rss: [{ at, views: 190, conflicted: true, model_eligible: false }] });

test('a chart preserves archived history and overlays corrected/latest observations', async () => {
  const read = createHybridChartReader({ baseline: async () => saved(), current: async () => latest() });
  const result = await read('video');
  expect(result.file?.samples.map(p => p.views)).toEqual([100, 200]);
  expect(result.file?.rss[0]).toMatchObject({ conflicted: true, eligible: false });
  expect(result.status).toBe('current');
  expect(result.asOf).toBe(at);
});

test('a chart without a saved baseline renders compact state without claiming verified historical coverage', async () => {
  const current = jest.fn(async () => latest());
  const read = createHybridChartReader({ baseline: async () => null, current });
  expect((await read('video')).file?.samples[0].views).toBe(200);
  expect((await read('video')).status).toBe('partial');
  expect(current).toHaveBeenCalledTimes(1);
});

test('50 concurrent views share one assembly and repeated views use the short cache', async () => {
  const baseline = jest.fn(async () => saved());
  const current = jest.fn(async () => latest());
  const read = createHybridChartReader({ baseline, current });
  const results = await Promise.all(Array.from({ length: 50 }, () => read('video')));
  await read('video');
  expect(baseline).toHaveBeenCalledTimes(1);
  expect(current).toHaveBeenCalledTimes(1);
  expect(results.every(r => r.file?.samples[1].views === 200)).toBe(true);
});

test('refreshes compact state after 60 seconds while reusing the historical baseline', async () => {
  let now = 0;
  const baseline = jest.fn(async () => saved());
  const current = jest.fn(async () => latest());
  const read = createHybridChartReader({ baseline, current, now: () => now });
  await read('video');
  now = 60_001;
  current.mockResolvedValue({ ...latest(), built_at: '2026-09-18T12:01:00Z', samples: [{ at, views: 300 }] });
  expect((await read('video')).file?.samples.map(p => p.views)).toEqual([100, 300]);
  expect(baseline).toHaveBeenCalledTimes(1);
  expect(current).toHaveBeenCalledTimes(2);
});

test('state outage returns the saved baseline honestly, never a fresh timestamp', async () => {
  const read = createHybridChartReader({ baseline: async () => saved(), current: async () => { throw Error('db down'); } });
  expect(await read('video')).toMatchObject({ status: 'saved', asOf: oldAt });
});

test('failed reads recover on retry instead of retaining a rejected promise', async () => {
  const current = jest.fn().mockRejectedValueOnce(Error('down')).mockResolvedValue(latest());
  const read = createHybridChartReader({ baseline: async () => null, current });
  expect((await read('video')).status).toBe('unavailable');
  expect((await read('video')).status).toBe('partial');
});

test('rejects a cross-video object rather than displaying another video history', async () => {
  const read = createHybridChartReader({ baseline: async () => saved('other'), current: async () => latest() });
  const result = await read('video');
  expect(result.file?.video_id).toBe('video');
  expect(result.file?.samples.map(p => p.views)).toEqual([200]);
  expect(result.status).toBe('partial');
});

test('correction deletes remove saved points, while unrelated archived points survive', async () => {
  const current = { ...latest(), samples: [], deleted: [{ source: 'sample' as const, at }] };
  const read = createHybridChartReader({ baseline: async () => saved(), current: async () => current });
  expect((await read('video')).file?.samples.map(p => p.views)).toEqual([100]);
});

test('current publication time and packaging are authoritative, including removed versions', async () => {
  const baseline = { ...saved(), titles: [{ version: 1, title: 'removed', first_seen: oldAt }] };
  const current = { ...latest(), published_at: at };
  const read = createHybridChartReader({ baseline: async () => baseline, current: async () => current });
  expect((await read('video')).file).toMatchObject({ published_at: at, titles: [] });
});

test('a stalled state read returns saved history within the reader deadline', async () => {
  jest.useFakeTimers();
  const read = createHybridChartReader({ baseline: async () => saved(), current: () => new Promise(() => {}) });
  const result = read('video');
  await jest.advanceTimersByTimeAsync(1500);
  const sentinel = Symbol('still waiting');
  expect(await Promise.race([result, Promise.resolve(sentinel)])).not.toBe(sentinel);
  jest.useRealTimers();
});

test('an outage preserves the last assembled chart instead of regressing to an older baseline', async () => {
  let now = 0;
  const current = jest.fn().mockResolvedValueOnce(latest()).mockRejectedValue(Error('unavailable'));
  const read = createHybridChartReader({ baseline: async () => saved(), current, now: () => now });
  await read('video');
  now = 60_001;
  const result = await read('video');
  expect(result.status).toBe('saved');
  expect(result.asOf).toBe(at);
  expect(result.file?.samples.map(p => p.views)).toEqual([100, 200]);
});

test('failed historical reads expose partial coverage instead of certifying a complete chart', async () => {
  const read = createHybridChartReader({ baseline: async () => { throw Error('R2 unavailable'); }, current: async () => latest() });
  expect((await read('video')).status).toBe('partial');
});

test('bounded day replay reads only requested charts and reuses six-hour baselines', async () => {
  let now = 0;
  const baseline = jest.fn(async (id: string) => saved(id));
  const current = jest.fn(async (id: string) => latest(id));
  const read = createHybridChartReader({ baseline, current, now: () => now });
  // Explicit synthetic audience: 100 active charts requested hourly, ten concurrent readers.
  // Ingestion is independent: its corpus size does not enter this read interface.
  for (let hour = 0; hour < 24; hour++) {
    now = hour * 3_600_000;
    for (let video = 0; video < 100; video++) {
      const result = await Promise.all(Array.from({ length: 10 }, () => read(`v${video}`)));
      expect(result.every(r => r.file?.samples[1].views === 200)).toBe(true);
    }
  }
  expect(baseline).toHaveBeenCalledTimes(400);
  expect(current).toHaveBeenCalledTimes(2400);
  expect(new Set(baseline.mock.calls.map(([id]) => id)).size).toBe(100);
});

test('cache eviction bounds the working set instead of retaining the whole corpus', async () => {
  const current = jest.fn(async (id: string) => latest(id));
  const read = createHybridChartReader({ baseline: async id => saved(id), current });
  for (let i = 0; i < 300; i++) await read(`v${i}`);
  await read('v0');
  expect(current).toHaveBeenCalledTimes(301);
});
