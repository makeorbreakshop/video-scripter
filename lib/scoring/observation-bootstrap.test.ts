import fs from 'node:fs';
import path from 'node:path';
import { buildSeriesFile } from '../readings/series';
import {
  BOOTSTRAP_RAW_COUNT_SQL,
  BOOTSTRAP_RAW_ROWS_SQL,
  BOOTSTRAP_LATEST_WRITE_SQL,
  BOOTSTRAP_CLAIM_SQL,
  DEFAULT_BOOTSTRAP_R2_CONCURRENCY,
  MAX_BOOTSTRAP_VIDEOS,
  MAX_BOOTSTRAP_R2_CONCURRENCY,
  bootstrapSource,
  observationStateFromRows,
  runSequentialBootstrapBatches,
  validateBootstrapR2Concurrency,
  validateRawBootstrapBudget,
} from './observation-bootstrap';
import { observationsFromState } from './observation-state';

test('R2 is accepted after cutover or when a narrow latest-write proof shows it was current', () => {
  const old = buildSeriesFile({ videoId: 'v', publishedAt: '2026-09-01', builtAt: '2026-09-10T10:00:00Z' });
  const fresh = buildSeriesFile({ videoId: 'v', publishedAt: '2026-09-01', builtAt: '2026-09-11T16:00:00Z' });
  expect(bootstrapSource(old, '2026-09-11T15:30:00Z', '2026-09-10T09:00:00Z')).toBe('r2');
  expect(bootstrapSource(old, '2026-09-11T15:30:00Z', '2026-09-10T11:00:00Z')).toBe('raw');
  expect(bootstrapSource(fresh, '2026-09-11T15:30:00Z', '2026-09-11T17:00:00Z')).toBe('r2');
  expect(bootstrapSource(old, '2026-09-11T15:30:00Z', null)).toBe('r2');
  expect(bootstrapSource(null, '2026-09-11T15:30:00Z', null)).toBe('raw');
});

test('raw bootstrap is impossible without both explicit budgets', () => {
  expect(() => validateRawBootstrapBudget({ videos: 2, rows: 10 }, {})).toThrow('raw-video-budget');
  expect(() => validateRawBootstrapBudget({ videos: 2, rows: 10 }, { rawVideoBudget: 2 })).toThrow('raw-row-budget');
  expect(() => validateRawBootstrapBudget({ videos: 3, rows: 10 }, { rawVideoBudget: 2, rawRowBudget: 10 })).toThrow('video');
  expect(() => validateRawBootstrapBudget({ videos: 2, rows: 11 }, { rawVideoBudget: 2, rawRowBudget: 10 })).toThrow('row');
  expect(validateRawBootstrapBudget({ videos: 2, rows: 10 }, { rawVideoBudget: 2, rawRowBudget: 10 })).toBeUndefined();
});

test('R2 bootstrap concurrency is useful by default and hard-capped', () => {
  expect(DEFAULT_BOOTSTRAP_R2_CONCURRENCY).toBe(16);
  expect(MAX_BOOTSTRAP_R2_CONCURRENCY).toBe(16);
  expect(validateBootstrapR2Concurrency(1)).toBe(1);
  expect(validateBootstrapR2Concurrency(16)).toBe(16);
  expect(() => validateBootstrapR2Concurrency(0)).toThrow('positive integer');
  expect(() => validateBootstrapR2Concurrency(17)).toThrow('exceeds hard limit 16');

  const script = fs.readFileSync(path.join(process.cwd(), 'scripts/bootstrap-observation-cache.ts'), 'utf8');
  expect(script).toContain('mapWithConcurrency');
  expect(script).toContain('--r2-concurrency');
});

test('the tiny count query is separate from and precedes the raw-row query', () => {
  expect(BOOTSTRAP_CLAIM_SQL).not.toMatch(/for update/i);
  expect(BOOTSTRAP_LATEST_WRITE_SQL).toMatch(/max\(s\.created_at\)/i);
  expect(BOOTSTRAP_LATEST_WRITE_SQL).toMatch(/max\(s\.sampled_at\)/i);
  expect(BOOTSTRAP_LATEST_WRITE_SQL).toMatch(/max\(coalesce\(s\.received_at,s\.at\)\)/i);
  expect(BOOTSTRAP_LATEST_WRITE_SQL).not.toMatch(/select[^]*(views|view_count)[,\s]/i);
  expect(BOOTSTRAP_RAW_COUNT_SQL).toMatch(/count\(\*\)/i);
  expect(BOOTSTRAP_RAW_COUNT_SQL).not.toMatch(/select[^]*(views|view_count)[,\s]/i);
  expect(BOOTSTRAP_RAW_ROWS_SQL).toContain('view_snapshots');
  expect(BOOTSTRAP_RAW_ROWS_SQL).toContain('view_samples');
  expect(BOOTSTRAP_RAW_ROWS_SQL).toContain('rss_samples');
  const script = fs.readFileSync(path.join(process.cwd(), 'scripts/bootstrap-observation-cache.ts'), 'utf8');
  expect(script).toContain('--raw-video-budget');
  expect(script).toContain('--raw-row-budget');
  expect(script.indexOf('BOOTSTRAP_LATEST_WRITE_SQL')).toBeLessThan(script.indexOf('BOOTSTRAP_RAW_COUNT_SQL'));
  expect(script.indexOf('BOOTSTRAP_RAW_COUNT_SQL')).toBeLessThan(script.indexOf('BOOTSTRAP_RAW_ROWS_SQL'));
});

test('bootstrap reserves a bounded recent-dependency lane without starving FIFO repair', () => {
  expect(MAX_BOOTSTRAP_VIDEOS).toBe(500);
  expect(BOOTSTRAP_CLAIM_SQL).toMatch(/recent_dependencies as materialized/i);
  expect(BOOTSTRAP_CLAIM_SQL).toContain("marked_at >= now() - interval '10 minutes'");
  expect(BOOTSTRAP_CLAIM_SQL).toMatch(/ceil\(\$1::numeric \/ 5\)/i);
  expect(BOOTSTRAP_CLAIM_SQL).toMatch(/fifo as materialized/i);
  expect(BOOTSTRAP_CLAIM_SQL).toMatch(/not exists \(select 1 from recent_dependencies/i);
  expect(BOOTSTRAP_CLAIM_SQL).toMatch(/greatest\(\$1 - \(select count\(\*\) from recent_dependencies\), 0\)/i);
});

test('scheduled bootstrap runs at most two bounded batches sequentially', async () => {
  const active = { current: 0, peak: 0 };
  const runBatch = jest.fn(async () => {
    active.current++;
    active.peak = Math.max(active.peak, active.current);
    await Promise.resolve();
    active.current--;
    return { videos: 500 };
  });

  const results = await runSequentialBootstrapBatches({
    maxBatches: 99,
    signal: new AbortController().signal,
    runBatch,
  });

  expect(results).toHaveLength(2);
  expect(runBatch).toHaveBeenCalledTimes(2);
  expect(active.peak).toBe(1);
});

test('sequential bootstrap stops after an empty batch or an aborted job budget', async () => {
  const emptyRun = jest.fn()
    .mockResolvedValueOnce({ videos: 500 })
    .mockResolvedValueOnce({ videos: 0 })
    .mockResolvedValueOnce({ videos: 500 });
  const emptyResults = await runSequentialBootstrapBatches({
    maxBatches: 2,
    signal: new AbortController().signal,
    runBatch: emptyRun,
  });
  expect(emptyResults.map((result) => result.videos)).toEqual([500, 0]);
  expect(emptyRun).toHaveBeenCalledTimes(2);

  const controller = new AbortController();
  const budgetRun = jest.fn(async () => {
    controller.abort();
    return { videos: 500 };
  });
  const budgetResults = await runSequentialBootstrapBatches({
    maxBatches: 2,
    signal: controller.signal,
    runBatch: budgetRun,
  });
  expect(budgetResults).toHaveLength(1);
  expect(budgetRun).toHaveBeenCalledTimes(1);
});

test('a raw bootstrap preserves source flags and produces the canonical observations', () => {
  const state = observationStateFromRows('v', '2026-09-01T00:00:00Z', [
    { source: 'snapshot', at: '2026-09-02T12:00:00Z', views: 100 },
    { source: 'rss', at: '2026-09-02T10:00:00Z', views: 90, model_eligible: true, conflicted: false },
    { source: 'rss', at: '2026-09-03T10:00:00Z', views: 150, model_eligible: false, conflicted: false },
  ], 7);
  expect(state.lastChangeId).toBe(7);
  expect(state.points).toHaveLength(3);
  expect(observationsFromState(state).map((point) => point.views)).toEqual([90]);
});
