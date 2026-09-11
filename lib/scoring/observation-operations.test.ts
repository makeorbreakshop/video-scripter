import fs from 'node:fs';
import path from 'node:path';

test('the guarded rollout surface replaces unbounded legacy jobs', () => {
  const root = process.cwd();
  for (const obsolete of [
    '../backfill-obs-cache.ts',
    'com.mfm.video-scripter-obs-cache-backfill.plist',
    'com.mfm.video-scripter-series-backfill.plist',
    'com.mfm.video-scripter-series-drain.plist',
  ]) {
    expect(fs.existsSync(path.join(root, 'scripts/launchd', obsolete))).toBe(false);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  expect(pkg.scripts['observations:materialize']).toBe('tsx scripts/materialize-observations.ts');
  expect(pkg.scripts['observations:bootstrap']).toBe('tsx scripts/bootstrap-observation-cache.ts');
  expect(pkg.scripts['scores:drain']).toBe('tsx scripts/score-videos.ts --limit 1000');
  expect(pkg.scripts['scores:rollout']).toBe('tsx scripts/enqueue-score-rollout.ts');
  expect(pkg.scripts['observations:health']).toBe('tsx scripts/observation-pipeline-health.ts');
  expect(pkg.scripts['series:backfill']).toBeUndefined();
  const runbook = fs.readFileSync(path.join(root, 'docs/runbooks/2026-09-11-event-driven-scoring.md'), 'utf8');
  expect(runbook).toContain('Capture first');
  expect(runbook).toContain('Raw fallback budget: zero');
  expect(runbook).toContain('Rollback');
});
