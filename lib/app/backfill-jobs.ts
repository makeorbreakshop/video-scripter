// The onboarding queue: enqueue on connect, drain with scripts/analytics-backfill-worker.ts.
// Direct Postgres only (lib/admin/db.ts).
import { q, one } from '../admin/db';
import { planWindows, estimateQueries } from './analytics-queue';

export const WINDOW_DAYS = 90;

export type BackfillStatus = 'queued' | 'running' | 'done' | 'failed';

export interface BackfillJob {
  id: string; user_id: string; channel_id: string; status: BackfillStatus;
  first_date: string | null; last_date: string | null; cursor_date: string | null;
  windows_total: number; windows_done: number; rows_written: number;
  queries_spent: number; attempts: number; error: string | null;
  requested_at: string; started_at: string | null; finished_at: string | null;
}

/**
 * Queue a channel's history import. Idempotent: re-connecting a channel whose import already
 * finished does not redo it, but a failed one is retried.
 */
export async function enqueueBackfill(userId: string, channelId: string): Promise<void> {
  const first = await one<{ d: string | null }>(
    `select to_char(min(published_at), 'YYYY-MM-DD') as d from videos where channel_id = $1`, [channelId]
  );
  const firstDate = first?.d ?? null;
  const lastDate = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10); // API lags ~2 days
  const total = firstDate ? planWindows(firstDate, lastDate, WINDOW_DAYS).length : 0;
  await q(
    `insert into analytics_backfill_jobs (user_id, channel_id, first_date, last_date, cursor_date, windows_total, status)
     values ($1,$2,$3,$4,$3,$5,'queued')
     on conflict (user_id, channel_id) do update
       set status = case when analytics_backfill_jobs.status = 'done' then 'done' else 'queued' end,
           last_date = excluded.last_date,
           first_date = coalesce(analytics_backfill_jobs.first_date, excluded.first_date),
           cursor_date = coalesce(analytics_backfill_jobs.cursor_date, excluded.cursor_date),
           windows_total = greatest(analytics_backfill_jobs.windows_total, excluded.windows_total),
           error = null`,
    [userId, channelId, firstDate, lastDate, total]
  );
}

/** Oldest queued jobs first, so the person who has waited longest is served first. */
export async function claimNextJob(): Promise<BackfillJob | null> {
  const rows = await q<BackfillJob>(
    `update analytics_backfill_jobs set status = 'running', started_at = coalesce(started_at, now()),
            attempts = attempts + 1
      where id = (select id from analytics_backfill_jobs where status = 'queued'
                   order by requested_at limit 1 for update skip locked)
      returning *`
  );
  return rows[0] ?? null;
}

export async function saveProgress(
  id: string, patch: { cursor_date?: string | null; windows_done?: number; rows_written?: number; queries_spent?: number; status?: BackfillStatus; error?: string | null }
): Promise<void> {
  await q(
    `update analytics_backfill_jobs
        set cursor_date   = coalesce($2, cursor_date),
            windows_done  = coalesce($3, windows_done),
            rows_written  = rows_written + coalesce($4, 0),
            queries_spent = queries_spent + coalesce($5, 0),
            status        = coalesce($6, status),
            error         = $7,
            finished_at   = case when $6 in ('done','failed') then now() else finished_at end
      where id = $1`,
    [id, patch.cursor_date ?? null, patch.windows_done ?? null, patch.rows_written ?? null,
     patch.queries_spent ?? null, patch.status ?? null, patch.error ?? null]
  );
}

export async function jobsForUser(userId: string): Promise<BackfillJob[]> {
  return q<BackfillJob>(`select * from analytics_backfill_jobs where user_id = $1`, [userId]);
}

/** How the queue position reads to a person waiting. */
export async function queueDepth(): Promise<number> {
  const row = await one<{ n: number }>(`select count(*)::int as n from analytics_backfill_jobs where status = 'queued'`);
  return Number(row?.n ?? 0);
}

export { estimateQueries };
