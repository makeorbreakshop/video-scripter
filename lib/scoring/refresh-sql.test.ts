import fs from 'node:fs';
import path from 'node:path';
import { scoreRefreshSql } from './refresh-sql';
import { MODEL_VERSION } from './core';
import { OBSERVATION_SCORE_VERSION } from './observations';
test('the legacy refresh predicate remains available only for explicit rollout/bootstrap tooling', () => {
  const sql = scoreRefreshSql('v5.1-rss');
  expect(sql).toContain("sc.model_version is distinct from 'v5.1-rss'");
  expect(sql).toContain('coalesce(r.received_at, r.at) > sc.scored_at');
  expect(sql).toContain('s.sampled_at > sc.scored_at');
  const script = fs.readFileSync(path.join(process.cwd(), 'scripts/score-videos.ts'), 'utf8');
  const hourly = script.slice(script.indexOf('async function score('), script.indexOf('async function final('));
  expect(hourly).toContain(': ALL && FORCE');
  expect(hourly).toContain('scoreDirtyTargetsSql({');
  expect(hourly).not.toContain('incrementalScoreTargetsSql({');
});

test('a stored row carries the version of the MATH that produced it, not the observation tag', () => {
  // v5.2 rows must say 'v5.2'. Until 2026-09-07 every write used OBSERVATION_SCORE_VERSION, so
  // the v5.2 rescore landed labelled 'v5.1-rss' and could not be told from the v5.0 rows beside
  // it -- and the refresh watermark never fired, so nothing was due for rescore either.
  expect(MODEL_VERSION).not.toBe(OBSERVATION_SCORE_VERSION);
  const script = fs.readFileSync(path.join(process.cwd(), 'scripts/score-videos.ts'), 'utf8');
  expect(script).toContain('const SCORE_ROW_VERSION = MODEL_VERSION;');
  // every score write site goes through it; rollout queueing is tested separately
  expect(script).toContain('rowFromV5(b.t.id, b.t.channel_id, SCORE_ROW_VERSION');
  expect(script).toContain('const FINAL_VERSION = `${SCORE_ROW_VERSION}-final`;');
  // the observation contract keeps its provenance, in the history row's extra and nowhere else
  const [, after] = script.split('function writeScores');
  expect(after).toContain('observation_version: OBSERVATION_SCORE_VERSION');
  expect(script).not.toContain('rowFromV5(b.t.id, b.t.channel_id, OBSERVATION_SCORE_VERSION');
});
