// Explicit, bounded model-version rollout lane. It returns one summary row and no observations.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { makeTimedPool } from '../lib/admin/db';
import { SupabaseQueryTracer, supabaseApplicationName } from '../lib/admin/supabase-trace';
import { enqueueScoreRolloutSql } from '../lib/scoring/score-rollout';

const args = process.argv.slice(2);
const arg = (name: string): string | null => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};
const version = arg('--version') ?? '';
const limit = Number(arg('--limit') ?? 0);
const channels = (arg('--channels') ?? '').split(',').map((value) => value.trim()).filter(Boolean);
const cursorPublishedAt = arg('--cursor-published-at');
const cursorId = arg('--cursor-id');
if (Boolean(cursorPublishedAt) !== Boolean(cursorId)) throw new Error('both rollout cursor values are required together');
const query = enqueueScoreRolloutSql({
  version, limit, channels,
  cursor: cursorPublishedAt && cursorId ? { publishedAt: cursorPublishedAt, id: cursorId } : null,
});

const trace = new SupabaseQueryTracer('score-rollout');
const pool = makeTimedPool({
  connectionString: process.env.DATABASE_URL, max: 1, timeoutMs: 60_000,
  application_name: supabaseApplicationName('score-rollout'),
});
let traceStats: Record<string, number> = {};
try {
  const row = (await trace.query(pool, query.text, query.values)).rows[0];
  traceStats = { queued: Number(row?.queued ?? 0) };
  console.log(JSON.stringify({
    queued: Number(row?.queued ?? 0),
    nextCursor: row?.cursor_id ? { publishedAt: row.cursor_published_at, id: row.cursor_id } : null,
    version,
  }));
} catch (error) {
  trace.markFailed();
  throw error;
} finally {
  await pool.end();
  trace.finish(traceStats);
}
