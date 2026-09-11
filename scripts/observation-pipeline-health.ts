// Read-only, constant-size health report for the event-driven observation/scoring pipeline.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { makeTimedPool } from '../lib/admin/db';
import { SupabaseQueryTracer, supabaseApplicationName } from '../lib/admin/supabase-trace';

const trace = new SupabaseQueryTracer('observation-health', (line) => console.error(line));
const pool = makeTimedPool({
  connectionString: process.env.DATABASE_URL, max: 1, timeoutMs: 30_000,
  application_name: supabaseApplicationName('observation-health'),
});
try {
  const row = (await trace.query(pool, `/* trace:pipeline.health */
    select
      (select count(*)::int from observation_change_log) as change_rows,
      (select count(*)::int from obs_cache_dirty) as observation_queue,
      (select count(*)::int from obs_cache_dirty where requires_bootstrap) as bootstrap_queue,
      (select count(*)::int from score_dirty where not_before <= now()) as score_due,
      (select count(*)::int from series_dirty) as series_queue,
      (select count(*)::int from video_obs_cache where format=2) as format2_rows,
      (select coalesce(extract(epoch from now()-min(marked_at)),0)::int
         from obs_cache_dirty where not requires_bootstrap) as observation_oldest_seconds,
      (select coalesce(extract(epoch from now()-min(marked_at)),0)::int
         from score_dirty where not_before <= now()) as score_due_oldest_seconds,
      (select coalesce(extract(epoch from now()-min(marked_at)),0)::int
         from series_dirty) as series_oldest_seconds
  `)).rows![0];
  const report = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
  const unhealthy = report.observation_oldest_seconds > 15 * 60
    || report.score_due_oldest_seconds > 15 * 60
    || report.series_oldest_seconds > 30 * 60
    || report.change_rows > 100_000;
  console.log(JSON.stringify({ healthy: !unhealthy, ...report }));
  if (unhealthy) process.exitCode = 1;
} finally {
  await pool.end();
  trace.finish();
}
