// Admin read path: direct Postgres over DATABASE_URL, lazy pool so builds never connect.
// Never use supabase-js here (2026-08-31 org-wide egress incident).
import pg from 'pg';

let pool: pg.Pool | null = null;

export function getPool() {
  if (!pool) {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
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
