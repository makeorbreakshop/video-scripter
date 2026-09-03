-- Onboarding queue for owner-analytics history imports.
--
-- Connecting a channel does NOT pull its history inline: a full backfill is tens to hundreds
-- of Analytics API queries, and a burst of signups would trip the 720-queries-per-minute
-- project ceiling. Connecting enqueues, and scripts/analytics-backfill-worker.ts drains the
-- queue at a paced rate (lib/app/analytics-queue.ts).
--
-- Resumable: cursor_date is the start of the next window still to import, so a worker that
-- stops on budget or crashes picks up where it left off rather than starting over.
--
-- Apply with: npx tsx scripts/apply-sql.ts sql/analytics-backfill-jobs.sql

create table if not exists analytics_backfill_jobs (
  id            bigserial primary key,
  user_id       uuid not null references app_users(id) on delete cascade,
  channel_id    text not null,
  status        text not null default 'queued',   -- queued | running | done | failed
  first_date    date,                             -- channel's first upload
  last_date     date,                             -- through when history is wanted
  cursor_date   date,                             -- next window start; null until started
  windows_total integer not null default 0,
  windows_done  integer not null default 0,
  rows_written  integer not null default 0,
  queries_spent integer not null default 0,
  attempts      integer not null default 0,
  error         text,
  requested_at  timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  unique (user_id, channel_id)
);

create index if not exists idx_analytics_backfill_status on analytics_backfill_jobs (status, requested_at);
