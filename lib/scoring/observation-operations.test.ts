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
  // The worker owns the safe 1,000 default. Keeping it out of the npm wrapper lets a supervised
  // canary pass --limit 100 without an earlier duplicate flag silently winning.
  expect(pkg.scripts['scores:drain']).toBe('tsx scripts/score-videos.ts');
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

test('the scheduled score batch derives day-30 truth without a raw snapshot query', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'scripts', 'score-videos.ts'),
    'utf8',
  );
  const scheduledBatch = source.slice(source.indexOf('async function v5Batch'), source.indexOf('async function channelsSlowerThan'));
  expect(scheduledBatch).toContain('day30Sink: truth');
  expect(scheduledBatch).not.toContain('day30(priorIds)');
  expect(scheduledBatch).not.toMatch(/view_snapshots|view_samples|rss_samples/);
});

test('the migration maintains exact day-30 truth as a narrow event projection', () => {
  const migration = fs.readFileSync(
    path.join(process.cwd(), 'supabase', 'migrations', '20260911153000_event_driven_scoring.sql'),
    'utf8',
  );
  expect(migration).toContain('create table if not exists public.video_day30_truth');
  expect(migration).toContain('refresh_day30_truth');
  expect(migration).toMatch(/days_since_published between 27 and 33/i);
});
