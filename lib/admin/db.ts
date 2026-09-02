// Admin read path: direct Postgres over DATABASE_URL, lazy pool so builds never connect.
// Never use supabase-js here (2026-08-31 org-wide egress incident).
import pg from 'pg';

let pool: pg.Pool | null = null;

export function getPool() {
  if (!pool) {
    // Serverless: many instances × small pools exhaust the session-mode pooler (15 clients). Prefer the
    // transaction-mode pooler URL when provided and keep one connection per instance.
    const serverless = !!process.env.VERCEL;
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_POOLER_URL || process.env.DATABASE_URL,
      max: serverless ? 1 : 3,
      idleTimeoutMillis: serverless ? 5_000 : 30_000,
    });
    // pgbouncer strips startup options, so set the timeout per connection.
    pool.on('connect', (c: pg.PoolClient) => { c.query('set statement_timeout = 45000').catch(() => {}); });
  }
  return pool;
}

export async function q<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const { rows } = await getPool().query(sql, params);
  return rows as T[];
}

export async function one<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  const rows = await q<T>(sql, params);
  return rows[0] ?? null;
}
