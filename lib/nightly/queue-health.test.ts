import { assessQueues, queueAlertLine, QUEUE_HEALTH_SQL } from './queue-health';

const row = (o: Record<string, number> = {}) => ({
  observation_depth: 100, observation_oldest_seconds: 60,
  score_depth: 200, score_oldest_seconds: 60,
  series_depth: 300, series_oldest_seconds: 60, ...o,
});

test('a pipeline at cadence raises no queue alert', () => {
  expect(assessQueues(row(), false).some((q) => q.alert)).toBe(false);
});

test('the 2026-09-22 backlog alerts on all three queues with depth and oldest age', () => {
  const qs = assessQueues(row({
    observation_depth: 76_565, observation_oldest_seconds: 63_000,
    score_depth: 103_431, score_oldest_seconds: 1_005_840,
    series_depth: 141_708, series_oldest_seconds: 402_840,
  }), false);
  expect(qs.map((q) => q.alert)).toEqual([true, true, true]);
  expect(queueAlertLine(qs[0])).toMatch(/observation-materializer .*depth 76565 .*oldest 17\.5 h/);
});

test('an old but shallow queue still alerts on age alone', () => {
  expect(assessQueues(row({ score_depth: 10, score_oldest_seconds: 3 * 3600 }), false)[1].alert).toBe(true);
});

test('under hybrid charts the disabled series drain alerts only on runaway depth', () => {
  expect(assessQueues(row({ series_depth: 141_708, series_oldest_seconds: 402_840 }), true)[2].alert).toBe(false);
  expect(assessQueues(row({ series_depth: 300_000 }), true)[2].alert).toBe(true);
});

test('score age is measured from when a row became due, not when it was marked', () => {
  expect(QUEUE_HEALTH_SQL).toMatch(/now\(\)-min\(not_before\)\),0\)::int\s+from score_dirty where not_before <= now\(\)/);
});
