import path from 'path';
import { config } from 'dotenv';
import pg from 'pg';
import { EMBEDDING_DIMS, EMBEDDING_MODEL } from '../../lib/semantic/documents';

config({ path: path.resolve(process.cwd(), '.env.local') });

export const READ_BATCH_SIZE = 5_000;
export const QDRANT_BATCH_SIZE = 500;

let pool: pg.Pool | null = null;

export function db(): pg.Pool {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, idleTimeoutMillis: 30_000 });
    pool.on('connect', (client) => { client.query('set statement_timeout = 45000').catch(() => {}); });
  }
  return pool;
}

export async function closeDb(): Promise<void> {
  if (pool) await pool.end();
  pool = null;
}

export function chunks<T>(items: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}

export function argValue(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index === -1 ? null : argv[index + 1] ?? null;
}

export function intArg(argv: string[], name: string): number | null {
  const raw = argValue(argv, name);
  if (raw == null) return null;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

export function floatArg(argv: string[], name: string): number | null {
  const raw = argValue(argv, name);
  if (raw == null) return null;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

export function sinceDate(raw = '30d'): Date {
  const relative = /^(\d+)([dhm])$/.exec(raw);
  const unitMs = relative?.[2] === 'd' ? 86_400_000 : relative?.[2] === 'h' ? 3_600_000 : 60_000;
  const date = relative ? new Date(Date.now() - Number(relative[1]) * unitMs) : new Date(raw);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid --since value: ${raw}`);
  return date;
}

export async function currentHashes(entity: 'video' | 'channel', ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  if (ids.length > READ_BATCH_SIZE) throw new Error(`Hash lookup exceeds ${READ_BATCH_SIZE} ids`);
  const result = await db().query<{ id: string; doc_hash: string }>(
    `select id, doc_hash from embeddings_v1 where entity = $1 and id = any($2::text[])`,
    [entity, ids],
  );
  return new Map(result.rows.map((row) => [row.id, row.doc_hash]));
}

export async function recordEmbeddings(
  entity: 'video' | 'channel',
  rows: Array<{ id: string; hash: string }>,
  dimensions = EMBEDDING_DIMS,
): Promise<void> {
  if (!rows.length) return;
  if (rows.length > QDRANT_BATCH_SIZE) throw new Error(`Bookkeeping write exceeds ${QDRANT_BATCH_SIZE} rows`);
  await db().query(
    `insert into embeddings_v1 (entity, id, model, dims, doc_hash, embedded_at)
     select $1, input.id, $4, $5, input.hash, now()
       from unnest($2::text[], $3::text[]) as input(id, hash)
     on conflict (entity, id) do update
       set model = excluded.model, dims = excluded.dims, doc_hash = excluded.doc_hash,
           embedded_at = excluded.embedded_at`,
    [entity, rows.map((row) => row.id), rows.map((row) => row.hash), EMBEDDING_MODEL, dimensions],
  );
}

export async function costToday(): Promise<{ tokens: number; usd: number }> {
  const result = await db().query<{ tokens: string; usd: string }>(
    `select coalesce(sum(tokens), 0)::bigint as tokens, coalesce(sum(usd), 0)::numeric as usd
       from semantic_cost_ledger where date = current_date`,
  );
  return { tokens: Number(result.rows[0].tokens), usd: Number(result.rows[0].usd) };
}

export async function runMain(main: () => Promise<void>): Promise<void> {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
