import fs from 'node:fs';
import path from 'node:path';
import { scoreRefreshSql } from './refresh-sql';
test('resumable all-age scoring still requires missing/stale/version-mismatched evidence', () => {
  const sql = scoreRefreshSql('v5.1-rss');
  expect(sql).toContain("sc.model_version is distinct from 'v5.1-rss'");
  expect(sql).toContain('r.at > sc.scored_at');
  expect(sql).toContain('s.sampled_at > sc.scored_at');
  const script = fs.readFileSync(path.join(process.cwd(), 'scripts/score-videos.ts'), 'utf8');
  const hourly = script.slice(script.indexOf('async function score('), script.indexOf('async function final('));
  expect(hourly).toContain(': ALL && FORCE');
  expect(hourly).toContain('incrementalScoreTargetsSql({');
});
