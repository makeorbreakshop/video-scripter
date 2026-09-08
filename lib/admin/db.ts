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
  }
  return pool;
}

/** The role default this database runs at when nothing sets a timeout. */
export const DEFAULT_STATEMENT_TIMEOUT_MS = 45_000;

/**
 * Run `fn` with a statement timeout that actually applies.
 *
 * `pool.on('connect', c => c.query('set statement_timeout = …'))` — the pattern this repo used
 * in seven places — is broken on the :6543 transaction pooler: the SET is queued asynchronously
 * and lands after the queries it was meant to protect (measured 2026-09-08 — the first three
 * queries on a fresh client all reported the 5-minute role default). `?options=-c …` in the
 * connection string is stripped by Supavisor. `set local` inside an explicit transaction is the
 * one form that works, because the pooler cannot hand the connection away mid-transaction.
 *
 * Scripts that genuinely need more than the 300 s role default should connect on
 * DATABASE_SESSION_URL (:5432) instead, keeping session-mode clients ≤ 15.
 */
export async function withTimeout<T>(
  client: pg.PoolClient | pg.Client,
  timeoutMs: number,
  fn: (c: pg.PoolClient | pg.Client) => Promise<T>
): Promise<T> {
  const n = Math.max(1, Math.round(timeoutMs));
  // begin and the SET go in one simple-protocol message, so the guarantee costs one extra
  // round trip on the way in and one on the way out, not three.
  await client.query(`begin; set local statement_timeout = ${n}`);
  try {
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  }
}

/** withTimeout against a pool: checks a client out, wraps, always releases. */
export async function poolWithTimeout<T>(
  p: pg.Pool,
  timeoutMs: number,
  fn: (c: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await p.connect();
  try {
    return await withTimeout(client, timeoutMs, (c) => fn(c as pg.PoolClient));
  } finally {
    client.release();
  }
}

/**
 * A pool whose `pool.query(...)` actually honours `timeoutMs`.
 *
 * The scripts were all written as `pool.on('connect', … set statement_timeout …)` followed by
 * bare `pool.query(...)` calls, which silently ran at the 300 s role default. Rather than
 * rewrite every call site into an explicit transaction — which would also mean holding a pooler
 * connection open across a script's whole run — this wraps each `query` in its own
 * `begin; set local statement_timeout = N; …; commit`. Call sites stay exactly as they were.
 *
 * `pool.connect()` is untouched: a caller that checks a client out is doing something
 * transactional already and should use `withTimeout` directly.
 */
export function makeTimedPool(config: pg.PoolConfig & { timeoutMs: number }): pg.Pool {
  const { timeoutMs, ...poolConfig } = config;
  const p = new pg.Pool(poolConfig);
  const original = p.query.bind(p) as (...a: any[]) => Promise<any>;
  (p as any).query = (text: any, values?: any, cb?: any) => {
    // Callback form and cursor/QueryStream submittables bypass the wrapper — neither is used
    // by the scripts this exists for, and silently changing their semantics would be worse.
    if (typeof values === 'function' || typeof cb === 'function' || typeof text?.submit === 'function') {
      return original(text, values, cb);
    }
    return poolWithTimeout(p, timeoutMs, async (c) =>
      values === undefined ? c.query(text) : c.query(text, values));
  };
  return p;
}

/**
 * The app's read path. Deliberately NOT wrapped in withTimeout.
 *
 * Measured 2026-09-08 against the :6543 pooler: a plain parameterised query is 47.5 ms, the same
 * query inside `begin; set local statement_timeout; …; commit` is 140.9 ms — +93 ms, three times
 * the cost, on every read. A video page issues eight of them behind a pool of three or four, so
 * that is roughly +280 ms of server time per page view to buy a timeout.
 *
 * The old `pool.on('connect')` SET bought nothing at all (it landed after the queries it was
 * meant to protect), so removing it is not a regression — this path has been running at the role
 * default all along, and now says so.
 *
 * The right fix for the app path is server-side and free, and needs a decision rather than a
 * commit: `alter role <app role> set statement_timeout = '45s'`, which every connection then
 * inherits at no per-query cost. Until that is set, batch scripts get their limits through
 * makeTimedPool, where +93 ms against a multi-second statement is noise.
 */
export async function q<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const { rows } = await getPool().query(sql, params);
  return rows as T[];
}

export async function one<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  const rows = await q<T>(sql, params);
  return rows[0] ?? null;
}
