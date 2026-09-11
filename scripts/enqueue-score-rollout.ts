// Explicit, bounded model-version rollout lane. It returns one summary row and no observations.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { makeTimedPool } from '../lib/admin/db';
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

const pool = makeTimedPool({ connectionString: process.env.DATABASE_URL, max: 1, timeoutMs: 60_000 });
try {
  const row = (await pool.query(query.text, query.values)).rows[0];
  console.log(JSON.stringify({
    queued: Number(row?.queued ?? 0),
    nextCursor: row?.cursor_id ? { publishedAt: row.cursor_published_at, id: row.cursor_id } : null,
    version,
  }));
} finally {
  await pool.end();
}

