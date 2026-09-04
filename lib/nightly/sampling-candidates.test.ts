import { dueSamplingCandidatesSql, prioritizeApiCandidates } from './sampling-candidates';

test('reserves burst windows alongside a bounded oldest-deadline lane', () => {
  const query = dueSamplingCandidatesSql({
    denseVideoIds: ['dense-video'], denseChannelIds: ['dense-channel'], urgentLimit: 1250, oldestLimit: 5000,
  });
  expect(query.text).toContain("interval '2 hours'");
  expect(query.text).toContain("interval '1 hour'");
  expect(query.text).toContain("interval '22 hours'");
  expect(query.text).toContain('select video_id from urgent union select video_id from oldest');
  expect(query.values).toEqual([['dense-video'], ['dense-channel'], 1250, 5000]);
});

test('true bursts lead, while routine launch rows compete with fixed rows by oldest deadline', () => {
  const routineLaunch = Array.from({ length: 1251 }, (_, i) => ({
    row: { video_id: `routine-launch-${i}`, phase: 'launch', next_check: '2026-09-04 16:00:00.000000+00' },
    reason: 'missing_rss',
  }));
  const rows = [
    ...routineLaunch,
    { row: { video_id: 'fixed-late', phase: 'fixed', next_check: '2026-09-04 12:00:00.000000+00' }, reason: 'api_crosscheck_due' },
    { row: { video_id: 'true-burst', phase: 'launch', next_check: '2026-09-04 16:30:00.000000+00' }, reason: 'burst' },
  ];
  const selected = prioritizeApiCandidates(rows, 1250).map((x) => x.video_id);
  expect(selected.slice(0, 2)).toEqual(['true-burst', 'fixed-late']);
  expect(selected).toHaveLength(1250);
});
