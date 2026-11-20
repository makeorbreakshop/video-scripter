// A2's static half (docs/plans/2026-11-20-local-pipeline-db.md): no statement naming a pipeline
// table may reach Supabase. A source file that names one must either go through pipelinePool()
// (import lib/db/pipeline) or sit on MIGRATION_BACKLOG below.
//
// The backlog is a ratchet. It may only shrink: a new file naming a pipeline table fails, and a
// backlog file that no longer names one (or now imports the pipeline pool) fails until its
// entry is deleted. When it is empty, A2 holds statically; the pg_stat_statements delta is the
// runtime half.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pipelineTablesIn } from './pipeline';

const ROOT = path.resolve(__dirname, '..', '..');
const SCAN = ['app', 'lib', 'scripts'];
const SOURCE = /\.(ts|tsx|js|mjs|cjs)$/;
const SKIP_DIR = new Set(['node_modules', '.next', 'orchestrator', 'archive', 'retired']);
const SKIP_FILE = /\.(test|spec)\.(ts|tsx|js|cjs|mjs)$/;

/** Files still sending pipeline-table SQL to Supabase, and the work unit that moves them. */
const MIGRATION_BACKLOG: Record<string, string> = {
  'app/api/check-db-indexes/route.ts': 'U7 website',
  'app/api/debug-update-all/route.ts': 'U7 website',
  'app/api/performance/calculate-envelope/route.ts': 'U7 website',
  'app/api/performance/channel-baseline/route.ts': 'U7 website',
  'app/api/performance/classify-video/route.ts': 'U7 website',
  'app/api/pipeline/health/route.ts': 'U7 website',
  'app/api/tools/get-comprehensive-video-analysis/route.ts': 'U7 website',
  'app/api/tools/get-performance-timeline/route.ts': 'U7 website',
  'app/api/v1/videos/[id]/route.ts': 'U7 website',
  'app/api/videos/[videoId]/route.ts': 'U7 website',
  'app/api/videos/[videoId]/snapshots/route.ts': 'U7 website',
  'app/api/view-tracking/debug/route.ts': 'U7 website',
  'app/api/view-tracking/stats/route.ts': 'U7 website',
  'lib/admin/queries.ts': 'legacy: move or retire at U8',
  'lib/app/channels.ts': 'U7 website',
  'lib/app/video-page.ts': 'U7 website',
  'lib/hybrid-performance-cached.ts': 'legacy: move or retire at U8',
  'lib/ingest/first-sample.ts': 'U7 website (reading_inbox)',
  'lib/nightly/due-core.ts': 'U5 api sampling',
  'lib/nightly/launch-enroll.ts': 'U5 api sampling',
  'lib/nightly/queue-health.ts': 'U5 api sampling',
  'lib/nightly/sample-batch.ts': 'U5 api sampling',
  'lib/nightly/sampling-candidates.ts': 'U5 api sampling',
  'lib/ops/storage-contract.ts': 'legacy: move or retire at U8',
  'lib/pipeline/health-checks.ts': 'legacy: move or retire at U8',
  'lib/readings/chart-current.ts': 'U6 observation+scoring',
  'lib/readings/export-row-mirror.ts': 'U6 observation+scoring',
  'lib/readings/parquet-source.ts': 'U6 observation+scoring',
  'lib/readings/series-store.ts': 'U6 observation+scoring',
  'lib/readings/snapshot-retention.ts': 'U6 observation+scoring',
  'lib/readings/sql.ts': 'U6 observation+scoring',
  'lib/rss/current-response.ts': 'U4 rss',
  'lib/rss/poll-policy.ts': 'U4 rss',
  'lib/rss/response-store.ts': 'U4 rss',
  'lib/rss/retention.ts': 'U4 rss',
  'lib/rss/snapshot-triage.ts': 'U4 rss',
  'lib/rss/title-change.ts': 'U4 rss',
  'lib/scoring/harness-sql.ts': 'U6 observation+scoring',
  'lib/scoring/history.ts': 'U6 observation+scoring',
  'lib/scoring/launch-fit-mirror.ts': 'U6 observation+scoring',
  'lib/scoring/materialization-queue.ts': 'U6 observation+scoring',
  'lib/scoring/obs-cache.ts': 'U6 observation+scoring',
  'lib/scoring/observation-bootstrap.ts': 'U6 observation+scoring',
  'lib/scoring/observation-candidates.ts': 'U6 observation+scoring',
  'lib/scoring/observation-materializer.ts': 'U6 observation+scoring',
  'lib/scoring/observations.ts': 'U6 observation+scoring',
  'lib/scoring/paid-fit-mirror.ts': 'U6 observation+scoring',
  'lib/scoring/prior-load.ts': 'U6 observation+scoring',
  'lib/scoring/refresh-sql.ts': 'U6 observation+scoring',
  'lib/scoring/score-rollout.ts': 'U6 observation+scoring',
  'lib/temporal-baseline-processor.ts': 'legacy: move or retire at U8',
  'lib/view-tracking-service.ts': 'U5 api sampling',
  'scripts/analysis/detection-latency.ts': 'legacy: move or retire at U8',
  'scripts/analyze-all-snapshot-dates.js': 'legacy: move or retire at U8',
  'scripts/analyze-complete-tracking.js': 'U5 api sampling',
  'scripts/analyze-tracking-history.js': 'U5 api sampling',
  'scripts/analyze-view-snapshots-detailed.js': 'legacy: move or retire at U8',
  'scripts/analyze-view-snapshots.js': 'legacy: move or retire at U8',
  'scripts/apply-envelope-smoothing.js': 'legacy: move or retire at U8',
  'scripts/apply-next-track-at.ts': 'legacy: move or retire at U8',
  'scripts/backfill-catalog.ts': 'legacy: move or retire at U8',
  'scripts/backfill-direct.ts': 'legacy: move or retire at U8',
  'scripts/backfill-first-samples.ts': 'legacy: move or retire at U8',
  'scripts/backtest-baseline-trend.ts': 'legacy: move or retire at U8',
  'scripts/backtest-baseline.ts': 'legacy: move or retire at U8',
  'scripts/benchmark-v5.ts': 'legacy: move or retire at U8',
  'scripts/check-api-observation-reuse.ts': 'U6 observation+scoring',
  'scripts/check-band-calibration.ts': 'legacy: move or retire at U8',
  'scripts/check-paid-fit-reuse.ts': 'legacy: move or retire at U8',
  'scripts/deploy/deploy-and-test-paginated-function.js': 'legacy: move or retire at U8',
  'scripts/diagnose-curve.ts': 'legacy: move or retire at U8',
  'scripts/direct-count.js': 'legacy: move or retire at U8',
  'scripts/evaluate-rss-coordination.ts': 'U4 rss',
  'scripts/fit-forecast-bands.ts': 'legacy: move or retire at U8',
  'scripts/launch-track.ts': 'U5 api sampling (scheduler job)',
  'scripts/legacy-baselines/fix-temporal-baselines-correct.js': 'legacy: move or retire at U8',
  'scripts/legacy-baselines/fix-temporal-baselines-fast-resume.js': 'legacy: move or retire at U8',
  'scripts/legacy-baselines/fix-temporal-baselines-fast.js': 'legacy: move or retire at U8',
  'scripts/legacy-baselines/fix-temporal-baselines-median.js': 'legacy: move or retire at U8',
  'scripts/loo-paired.ts': 'legacy: move or retire at U8',
  'scripts/migrate-score-history.ts': 'U6 observation+scoring',
  'scripts/ml_data_export.js': 'legacy: move or retire at U8',
  'scripts/ml_data_export_resume.js': 'legacy: move or retire at U8',
  'scripts/ml_data_export_simple.js': 'legacy: move or retire at U8',
  'scripts/ml_data_export_streaming.js': 'legacy: move or retire at U8',
  'scripts/nightly-ingest.ts': 'U5 api sampling',
  'scripts/observation-pipeline-health.ts': 'U6 observation+scoring',
  'scripts/performance/populate_envelope_curves.js': 'legacy: move or retire at U8',
  'scripts/rebuild-series.ts': 'U6 observation+scoring (scheduler job)',
  'scripts/reclaim-table.ts': 'legacy: move or retire at U8',
  'scripts/recompute-baselines.ts': 'legacy: move or retire at U8',
  'scripts/rss-freshness-report.ts': 'U4 rss',
  'scripts/rss-poll.ts': 'U4 rss (scheduler job)',
  'scripts/score-gaps.ts': 'U6 observation+scoring',
  'scripts/score-videos.ts': 'U6 observation+scoring (scheduler job)',
  'scripts/scorecard-refresh.ts': 'U6 observation+scoring',
  'scripts/scratch/backtest-baseline-cadence.ts': 'legacy: move or retire at U8',
  'scripts/semantic/backfill-scores.ts': 'U6 observation+scoring',
  'scripts/series-coverage.ts': 'U6 observation+scoring',
  'scripts/simple-snapshot-check.js': 'legacy: move or retire at U8',
  'scripts/simple-sql-count.js': 'legacy: move or retire at U8',
  'scripts/testing/test_performance_calculations.js': 'legacy: move or retire at U8',
  'scripts/thumbnail-phash-backfill.ts': 'legacy: move or retire at U8',
  'scripts/thumbnail-watch.ts': 'U4 rss (scheduler job)',
  'scripts/track-due.ts': 'U5 api sampling',
  'scripts/tracking-summary.js': 'U5 api sampling',
  'scripts/validate-scoring.ts': 'U6 observation+scoring',
  'scripts/verify-archive.ts': 'legacy: move or retire at U8',
  'scripts/verify-observation-reads.ts': 'U6 observation+scoring',
  'scripts/verify-sample-batch.ts': 'U5 api sampling',
};

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) { if (!SKIP_DIR.has(name) && !name.startsWith('.')) walk(full, out); }
    else if (SOURCE.test(name) && !SKIP_FILE.test(name)) out.push(full);
  }
}

function violations(): Map<string, string[]> {
  const files: string[] = [];
  for (const d of SCAN) walk(path.join(ROOT, d), files);
  const found = new Map<string, string[]>();
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const rel = path.relative(ROOT, f);
    if (rel === path.join('lib', 'db', 'pipeline.ts')) continue;
    if (/from\s+['"](?:@\/|\.{1,2}\/)+(?:lib\/)?db\/pipeline['"]/.test(text)) continue;
    const tables = pipelineTablesIn(text);
    if (tables.length) found.set(rel, tables);
  }
  return found;
}

describe('pipelineTablesIn', () => {
  it('finds raw SQL and supabase-js references', () => {
    expect(pipelineTablesIn(`select * from public.rss_samples r join track_schedule t using (video_id)`))
      .toEqual(['rss_samples', 'track_schedule']);
    expect(pipelineTablesIn(`insert into view_snapshots (video_id) values ($1)`)).toEqual(['view_snapshots']);
    expect(pipelineTablesIn(`supabase.from('view_samples').select('*')`)).toEqual(['view_samples']);
    expect(pipelineTablesIn(`delete from score_dirty where video_id = any($1)`)).toEqual(['score_dirty']);
  });

  it('ignores serving tables and look-alike names', () => {
    expect(pipelineTablesIn(`select * from videos join video_scores using (video_id)`)).toEqual([]);
    expect(pipelineTablesIn(`select * from rss_samples_archive`)).toEqual([]);
    expect(pipelineTablesIn(`const rss_samples = 3; // rss_samples are counted elsewhere`)).toEqual([]);
  });
});

describe('pipeline table ownership guard', () => {
  const found = violations();

  it('sends no pipeline-table SQL to Supabase outside the migration backlog', () => {
    const unexpected = [...found].filter(([f]) => !(f in MIGRATION_BACKLOG)).map(([f, t]) => `${f}: ${t.join(', ')}`);
    expect(unexpected).toEqual([]);
  });

  it('keeps the backlog honest: every entry still needs moving', () => {
    expect(Object.keys(MIGRATION_BACKLOG).filter((f) => !found.has(f))).toEqual([]);
  });
});
