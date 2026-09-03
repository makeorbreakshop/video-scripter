// Admin read path: direct Postgres over DATABASE_URL, lazy pool so builds never connect.
// Never use supabase-js here (2026-08-31 org-wide egress incident).
import pg from 'pg';

let pool: pg.Pool | null = null;

export function getPool() {
  if (!pool) {
    // Serverless: many instances × small pools exhaust the session-mode pooler (15 clients),
    // so a direct DATABASE_URL gets one connection per instance. The transaction-mode pooler
    // hands a connection back at the end of each statement rather than holding it for the
    // session, so it carries far more clients — with DATABASE_POOLER_URL we can afford 4 even
    // on Vercel, which is what lets a page's Promise.all batch actually run in parallel
    // instead of serializing behind a single connection.
    const serverless = !!process.env.VERCEL;
    const pooled = !!process.env.DATABASE_POOLER_URL;
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_POOLER_URL || process.env.DATABASE_URL,
      max: serverless ? (pooled ? 4 : 1) : 3,
      // Serverless instances freeze between requests; drop idle sockets fast so a resumed
      // instance is not holding connections the pooler already considers dead.
      idleTimeoutMillis: serverless ? 5_000 : 30_000,
      keepAlive: true,
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
