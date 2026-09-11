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
  expect(runbook).toContain('estimated_response_bytes');
  expect(runbook).toContain('application_name');
  expect(runbook).toContain('Rollback');
});

test('every scheduled database worker emits attributed Supabase query traces', () => {
  const root = process.cwd();
  for (const file of [
    'materialize-observations.ts',
    'bootstrap-observation-cache.ts',
    'score-videos.ts',
    'rebuild-series.ts',
    'observation-pipeline-health.ts',
    'enqueue-score-rollout.ts',
  ]) {
    const source = fs.readFileSync(path.join(root, 'scripts', file), 'utf8');
    expect(source).toContain('SupabaseQueryTracer');
    expect(source).toContain('supabaseApplicationName');
    expect(source).toContain('application_name:');
    expect(source).toContain('.finish(');
  }
});

test('workers with explicit transactions set attribution after BEGIN', () => {
  const root = process.cwd();
  for (const file of [
    'materialize-observations.ts',
    'bootstrap-observation-cache.ts',
    'score-videos.ts',
  ]) {
    const source = fs.readFileSync(path.join(root, 'scripts', file), 'utf8');
    expect(source).toContain('setLocalApplicationName');
  }
});

test('an unhealthy pipeline marks the trace run failed before returning a failing exit code', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'scripts', 'observation-pipeline-health.ts'),
    'utf8',
  );
  expect(source).toMatch(
    /if \(unhealthy\) \{\s*trace\.markFailed\(\);\s*process\.exitCode = 1;\s*\}/,
  );
});
