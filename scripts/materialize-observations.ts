// Bounded steady-state observation materializer. It reads only compact cache rows plus the
// delta log captured by the database triggers; it never reads raw history tables.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import type { PoolClient } from 'pg';
import { makeTimedPool, setLocalApplicationName } from '../lib/admin/db';
import { SupabaseQueryTracer, supabaseApplicationName } from '../lib/admin/supabase-trace';
import {
  MATERIALIZER_LIMITS,
  materializeObservationBatch,
} from '../lib/scoring/observation-materializer';
import { startManagedJob } from '../lib/nightly/job-lifecycle';

const args = process.argv.slice(2);
const arg = (name: string, fallback: number): number => {
  const i = args.indexOf(name);
  const value = i >= 0 ? Number(args[i + 1]) : fallback;
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
};
const maxVideos = arg('--max-videos', MATERIALIZER_LIMITS.videos);
const maxChanges = arg('--max-changes', MATERIALIZER_LIMITS.changes);
const maxCacheBytes = arg('--max-cache-bytes', MATERIALIZER_LIMITS.cacheBytes);
const maxCompressedBytes = arg('--max-compressed-bytes', MATERIALIZER_LIMITS.compressedBytes);
const dryRun = args.includes('--dry-run') || args.includes('--dry');
const job = dryRun
  ? { acquired: true as const, signal: new AbortController().signal, finish: () => {} }
  : startManagedJob({ name: 'observation-materializer', args });
if (!job.acquired) process.exit(0);

const trace = new SupabaseQueryTracer('observation-materializer');
const pool = makeTimedPool({
  connectionString: process.env.DATABASE_URL, max: 2, timeoutMs: 60_000,
  application_name: supabaseApplicationName('observation-materializer'),
});
let client: PoolClient | null = null;
let traceStats: Record<string, number> = {};
try {
  client = await pool.connect();
  const tracedClient = { query: (sql: string, values?: any[]) => trace.query(client!, sql, values) };
  const result = await materializeObservationBatch(tracedClient, {
    maxVideos, maxChanges, maxCacheBytes, maxCompressedBytes, dryRun,
    afterBegin: (transaction) => setLocalApplicationName(
      transaction,
      supabaseApplicationName('observation-materializer'),
    ),
  });
  const s = result.stats;
  traceStats = {
    videos: s.videos, changes: s.changes, completed: s.completed,
    partial: s.partial, bootstraps: s.bootstraps, compressed_bytes: s.compressedBytes,
  };
  console.log(`observation materializer${dryRun ? ' [dry run]' : ''}: ${s.videos} videos, ${s.changes} deltas, `
    + `${s.completed} complete, ${s.partial} partial, ${s.bootstraps} bootstrap, ${s.compressedBytes} compressed bytes`);
} catch (error) {
  trace.markFailed();
  throw error;
} finally {
  client?.release();
  await pool.end();
  trace.finish(traceStats);
  job.finish();
}
