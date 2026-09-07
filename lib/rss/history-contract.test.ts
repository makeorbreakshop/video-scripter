import { mergeObservations, observationRecords } from '../scoring/observations';
import { buildSeries } from '../app/chart-series';
import { tooltipLines } from '../app/chart-style';
import { survivingSamples } from './retention';
test('RSS response-time estimate survives merging, plotting, and tooltip', () => {
  const actuals = mergeObservations('2026-09-01', [], [], [{ at: '2026-09-02', views: 100, timeBasis: 'response-date-estimate' }]);
  const point = buildSeries({ actuals, baseline: null, est30: null, mult: {}, horizonDay: 2 }).find(p => p.day === 1)!;
  expect(tooltipLines({ at: '2026-09-02', ...point })).toContain('RSS · estimated response time');
});
test('historical model replay cannot see a response received after its cutoff', () => {
  const rows = [{ video_id: 'v', published_at: '2026-09-01', at: '2026-09-02', views: 100, source: 'rss' as const, received_at: '2026-09-04' }];
  expect(observationRecords(rows, Date.parse('2026-09-03')).get('v')).toEqual([]);
});
test('retention preserves a model anchor when a later chart-only point exists', () => {
  const rows = [{ video_id: 'v', at: '2026-01-01T12:00Z', model_eligible: true }, { video_id: 'v', at: '2026-01-01T13:00Z', model_eligible: false }];
  expect(survivingSamples(rows, new Date('2026-09-01'))).toHaveLength(2);
});
