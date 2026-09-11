import fs from 'node:fs';
import path from 'node:path';

test('the default scorer is queue-driven and statically incapable of raw-history fallback', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'scripts/score-videos.ts'), 'utf8');
  const hourly = script.slice(script.indexOf('async function score('), script.indexOf('async function final('));
  expect(hourly).toContain('scoreDirtyTargetsSql({');
  expect(hourly).toContain('DEFAULT_SCORE_RUN_LIMIT');
  expect(hourly).toContain('ObservationCacheMissError');
  expect(hourly).toContain('SCORE_DIRTY_DEFER_SQL');
  expect(hourly).not.toContain('incrementalScoreTargetsSql({');

  const batch = script.slice(script.indexOf('async function v5Batch('), script.indexOf('async function channelsSlowerThan('));
  expect(batch).toContain('rawMissBudget: 0');
  expect(batch).toContain('requireFormat2: true');

  const writes = script.slice(script.indexOf('async function writeScores('), script.indexOf('function rowFromV5('));
  expect(writes).toContain('SCORE_DIRTY_CLEAR_SQL');
  expect(writes).toContain('JSON.stringify(claims)');
});
