import fs from 'node:fs';
import path from 'node:path';
import { buildSeriesFile } from './series';
import {
  applyObservationChanges,
  emptyObservationState,
  seriesInputFromObservationState,
  type ObservationChange,
} from '../scoring/observation-state';

test('format-2 observation state converts to the exact raw series source rows', () => {
  const changes: ObservationChange[] = [
    { changeId: 1, videoId: 'v', source: 'snapshot', operation: 'upsert', at: '2026-09-02T12:00:00Z', views: 100 },
    { changeId: 2, videoId: 'v', source: 'sample', operation: 'upsert', at: '2026-09-02T13:00:00Z', views: 110 },
    { changeId: 3, videoId: 'v', source: 'rss', operation: 'upsert', at: '2026-09-02T14:00:00Z', views: 120,
      timeBasis: 'response-date-estimate', receivedAt: '2026-09-02T14:01:00Z', modelEligible: false, conflicted: true },
  ];
  const state = applyObservationChanges(emptyObservationState('v', '2026-09-01T00:00:00Z'), changes);
  const input = seriesInputFromObservationState(state);
  const file = buildSeriesFile({ videoId: 'v', publishedAt: state.publishedAt, ...input });
  expect(file.snapshots.map((row) => row.views)).toEqual([100]);
  expect(file.samples.map((row) => row.views)).toEqual([110]);
  expect(file.rss).toEqual([expect.objectContaining({ views: 120, eligible: false, conflicted: true })]);
});

test('the R2 drainer never queries raw observation history or refreshes the score cache', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'scripts/rebuild-series.ts'), 'utf8');
  expect(script).toContain('OBS_CACHE_SERIES_READ_SQL');
  expect(script).toContain('MAX_SERIES_CACHE_BYTES = 25_000_000');
  expect(script).toContain('decodeObservationState');
  expect(script).not.toContain('SERIES_SQL.snapshots');
  expect(script).not.toContain('SERIES_SQL.samples');
  expect(script).not.toContain('SERIES_SQL.rss');
  expect(script).not.toContain('OBSERVATION_RECORDS_SQL');
  expect(script).not.toContain('refreshObsCache');
  expect(script).toContain('readSeriesFile');
  expect(script).toContain('JSON.stringify(done)');
  expect(script).toContain("seriesTargetDisposition(target?.generation, Boolean(current))");
  expect(script).toContain("disposition === 'retire-legacy'");
});
