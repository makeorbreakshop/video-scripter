import fs from 'node:fs';
import path from 'node:path';
import { buildSeriesFile } from '../readings/series';
import {
  BOOTSTRAP_RAW_COUNT_SQL,
  BOOTSTRAP_RAW_ROWS_SQL,
  BOOTSTRAP_LATEST_WRITE_SQL,
  BOOTSTRAP_CLAIM_SQL,
  bootstrapSource,
  observationStateFromRows,
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
