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
 * Re-measured 2026-09-08 (25 iterations each, same parameterised single-row read): plain median
 * 40 ms, wrapped median 128-183 ms. The +93 ms is real and reproducible, so this stays plain.
 *
 * Three cheaper ways to get a server-side limit on this path were tested that day and ALL FAIL:
 *
 *   pg.Pool({ statement_timeout: 45000 })   `show statement_timeout` returned 2min. Supavisor
 *                                           does not forward the startup parameter.
 *   pg.Pool({ options: '-c statement_timeout=45000' })   returned 5min, 5min, 2min - ignored,
 *                                           and the drift across three queries on one pool is
 *                                           Supavisor handing out whatever server connection is
 *                                           free. Nothing session-level is reliable here.
 *   ?options=-c%20statement_timeout in the URL           returned 2min. Stripped, as in the audit.
 *   pg.Pool({ query_timeout: 5000 })        aborts the CLIENT at 5 s but the backend keeps running:
 *                                           pg_stat_activity still showed the pg_sleep(60) active
 *                                           9 s after the client gave up. This is worse than no
 *                                           timeout - it orphans work instead of stopping it.
 *
 * That leaves `alter role ... set statement_timeout`, and the app cannot use it as things stand:
 * DATABASE_URL, DATABASE_POOLER_URL and every pipeline script all connect as the SAME role
 * (`select current_user` -> `postgres`). Setting 45 s on it would also cap track-due, rss-poll,
 * launch-track, feed-materialize and ~25 other plain-pool scripts, which is a worse failure than
 * the one being fixed. (Scripts on makeTimedPool are immune - their `set local` overrides the role
 * default - but most scripts are not on it.)
 *
 * So the real fix is a SEPARATE least-privilege role for the web app with its own role-level
 * timeout, and that is a decision, not a commit: it needs a new role + password and a Vercel
 * DATABASE_URL rotation. Until then this path runs at the role default and says so.
 */
export async function q<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const { rows } = await getPool().query(sql, params);
  return rows as T[];
}

export async function one<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  const rows = await q<T>(sql, params);
  return rows[0] ?? null;
}
