// Bounded steady-state observation materializer. It reads only compact cache rows plus the
// delta log captured by the database triggers; it never reads raw history tables.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { makeTimedPool } from '../lib/admin/db';
import {
  MATERIALIZER_LIMITS,
  materializeObservationBatch,
} from '../lib/scoring/observation-materializer';

const args = process.argv.slice(2);
const arg = (name: string, fallback: number): number => {
  const i = args.indexOf(name);
  const value = i >= 0 ? Number(args[i + 1]) : fallback;
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
};
const maxVideos = arg('--max-videos', MATERIALIZER_LIMITS.videos);
const maxChanges = arg('--max-changes', MATERIALIZER_LIMITS.changes);
const maxCompressedBytes = arg('--max-compressed-bytes', MATERIALIZER_LIMITS.compressedBytes);
const dryRun = args.includes('--dry-run') || args.includes('--dry');

const pool = makeTimedPool({ connectionString: process.env.DATABASE_URL, max: 2, timeoutMs: 60_000 });
const client = await pool.connect();
try {
  const result = await materializeObservationBatch(client, {
    maxVideos, maxChanges, maxCompressedBytes, dryRun,
  });
  const s = result.stats;
  console.log(`observation materializer${dryRun ? ' [dry run]' : ''}: ${s.videos} videos, ${s.changes} deltas, `
    + `${s.completed} complete, ${s.partial} partial, ${s.bootstraps} bootstrap, ${s.compressedBytes} compressed bytes`);
} finally {
  client.release();
  await pool.end();
}

