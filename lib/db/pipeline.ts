// The local pipeline database (docs/plans/2026-11-20-local-pipeline-db.md).
//
// Supabase is the serving store; the raw readings, the work queues and the trigger chain that
// connects them live in a Postgres 17 on the Mac Studio (scripts/pipeline-db-init.sh). A
// statement goes to the database that OWNS its table: anything in PIPELINE_TABLES through
// pipelinePool(), everything else through the existing Supabase pools. lib/db/pipeline-guard.test.ts
// fails when SQL naming one of these tables appears in a file that has not been moved yet and
// is not on that test's migration backlog.
import pg from 'pg';

export const DEFAULT_PIPELINE_DATABASE_URL = 'postgresql://localhost:5434/channelsmith_pipeline';

/** Local system of record after the cut. Their Supabase copies are dropped at U8. */
export const PIPELINE_TABLES = [
  'rss_samples', 'rss_latest', 'rss_response_state',
  'view_samples', 'view_snapshots',
  'observation_change_log', 'video_obs_cache', 'obs_cache_dirty', 'score_dirty', 'series_dirty', 'mirror_dirty',
  'video_score_history', 'track_schedule', 'view_tracking_priority',
  'description_versions', 'video_title_watch', 'video_day30_truth',
] as const;
export type PipelineTable = (typeof PIPELINE_TABLES)[number];

/**
 * Read replicas kept locally for triggers and joins. Supabase stays authoritative; the
 * pipeline reads them locally and writes changes to Supabase.
 */
export const REPLICA_TABLES = ['videos', 'video_scores'] as const;

let pool: pg.Pool | null = null;

export function pipelineDatabaseUrl(): string {
  return process.env.PIPELINE_DATABASE_URL || DEFAULT_PIPELINE_DATABASE_URL;
}

/** Lazy, so importing this module never opens a connection (builds, the website). */
export function pipelinePool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: pipelineDatabaseUrl(),
      max: Number(process.env.PIPELINE_POOL_MAX ?? 4),
      idleTimeoutMillis: 30_000,
      // A local socket: no pooler stripping session settings, so a connection-level timeout
      // holds (unlike the Supabase :6543 path, lib/admin/db.ts).
      statement_timeout: Number(process.env.PIPELINE_STATEMENT_TIMEOUT_MS ?? 600_000),
    });
  }
  return pool;
}

export async function closePipelinePool(): Promise<void> {
  const p = pool;
  pool = null;
  if (p) await p.end();
}

const TABLE_REF = new RegExp(
  String.raw`\b(?:from|join|into|update|truncate(?:\s+table)?|delete\s+from|copy|table)\s+(?:only\s+)?(?:public\.)?"?(` +
  PIPELINE_TABLES.join('|') + String.raw`)"?\b`,
  'gi',
);

/** supabase-js: `.from('rss_samples')` goes to Supabase as surely as raw SQL does. */
const CLIENT_REF = new RegExp(String.raw`\.from\(\s*['"\x60](` + PIPELINE_TABLES.join('|') + String.raw`)['"\x60]`, 'g');

/** Pipeline tables a piece of SQL (or a whole source file) reads or writes. */
export function pipelineTablesIn(sql: string): PipelineTable[] {
  const found = new Set<PipelineTable>();
  for (const m of sql.matchAll(TABLE_REF)) found.add(m[1].toLowerCase() as PipelineTable);
  for (const m of sql.matchAll(CLIENT_REF)) found.add(m[1] as PipelineTable);
  return [...found].sort();
}
