// Pooler-safe run lease for the hourly semantic sync.
//
// The previous guard was a session-scoped pg advisory lock. DATABASE_URL points at Supavisor in
// transaction mode, so the lock lived on whichever pooled backend the statement happened to run on.
// If the process died without unlocking, the backend kept the lock and every later run saw it as
// held and skipped silently. A lease row has no such affinity: it is ordinary data, it expires on
// its own, and every decision is a single atomic statement.
//
// This module holds the pure logic (decisions and SQL text) so it can be unit-tested without a
// database. `scripts/semantic/sync-semantic.ts` wires it to the pool.

export const LEASE_NAME = 'channelsmith-semantic-sync';
export const LEASE_TABLE = 'semantic_sync_lease';
// The TTL only needs to outlive the longest gap between heartbeats, plus margin for a heartbeat
// waiting behind a long statement on the single-connection pool (statement_timeout is 45 s).
export const LEASE_TTL_MS = 5 * 60_000;
export const HEARTBEAT_MS = 60_000;

export interface LeaseRow {
  holder: string;
  acquired_at: Date;
  heartbeat_at: Date;
  expires_at: Date;
}

export type LeaseState = 'free' | 'held' | 'stale';

export function leaseState(row: LeaseRow | null | undefined, now: Date): LeaseState {
  if (!row) return 'free';
  return row.expires_at.getTime() <= now.getTime() ? 'stale' : 'held';
}

/** Whether `--break-stale-lock` may clear this row: only a lease past its TTL, never a live one. */
export function canBreak(row: LeaseRow | null | undefined, now: Date): boolean {
  return leaseState(row, now) === 'stale';
}

export function holderId(hostname: string, pid: number, startedAt: Date): string {
  return `${hostname}:${pid}:${startedAt.toISOString()}`;
}

export type AcquireOutcome =
  | { lock: 'acquired'; waited_ms: number; took_over_stale_from: string | null; stale_since: string | null }
  | { lock: 'skipped'; waited_ms: number; held_by: string; held_since: string; expires_at: string };

/**
 * Interprets an acquire attempt. `before` is the row read just before the upsert (for logging
 * only; the upsert itself is the atomic decision), `acquired` is whether the upsert returned a row,
 * `after` is the row re-read when it did not.
 */
export function acquireOutcome(
  before: LeaseRow | null,
  acquired: boolean,
  after: LeaseRow | null,
  now: Date,
  waitedMs: number,
): AcquireOutcome {
  if (acquired) {
    const tookOver = leaseState(before, now) === 'stale' ? before! : null;
    return {
      lock: 'acquired',
      waited_ms: waitedMs,
      took_over_stale_from: tookOver?.holder ?? null,
      stale_since: tookOver?.expires_at.toISOString() ?? null,
    };
  }
  const existing = after ?? before;
  if (!existing) throw new Error('lease acquire rejected but no lease row exists');
  return {
    lock: 'skipped',
    waited_ms: waitedMs,
    held_by: existing.holder,
    held_since: existing.acquired_at.toISOString(),
    expires_at: existing.expires_at.toISOString(),
  };
}

// One statement: insert, or take over only when the existing lease has expired. Postgres evaluates
// the DO UPDATE WHERE against the conflicting row, so a live lease returns zero rows and nothing is
// written. $1 name, $2 holder, $3 ttl in milliseconds.
export const ACQUIRE_SQL = `
  insert into ${LEASE_TABLE} as l (name, holder, acquired_at, heartbeat_at, expires_at)
  values ($1, $2, now(), now(), now() + ($3::bigint * interval '1 millisecond'))
  on conflict (name) do update
    set holder = excluded.holder, acquired_at = excluded.acquired_at,
        heartbeat_at = excluded.heartbeat_at, expires_at = excluded.expires_at
    where l.expires_at <= now()
  returning holder`;

export const READ_SQL = `select holder, acquired_at, heartbeat_at, expires_at from ${LEASE_TABLE} where name = $1`;

// Heartbeat and release are scoped to (name, holder): a run that lost its lease to a takeover must
// not extend or delete the new holder's row.
export const HEARTBEAT_SQL = `
  update ${LEASE_TABLE}
     set heartbeat_at = now(), expires_at = now() + ($3::bigint * interval '1 millisecond')
   where name = $1 and holder = $2`;

export const RELEASE_SQL = `delete from ${LEASE_TABLE} where name = $1 and holder = $2`;

// Only removes an expired row; a live lease is untouched. Returns the cleared holder, if any.
export const BREAK_STALE_SQL = `delete from ${LEASE_TABLE} where name = $1 and expires_at <= now() returning holder, acquired_at`;
