// Runtime invariants for the nightly pipeline, as pure helpers + their SQL so the health
// endpoint stays a thin wrapper and the thresholds can be unit-tested.
import { SHORT_MAX_SECONDS } from '../scoring/longform';

export type CheckStatus = 'ok' | 'warn' | 'fail';

/**
 * How many recent <=180s uploads may sit unverified before something is wrong.
 * Every ingest path settles a 63-180s clip against YouTube at insert time
 * (lib/ingest/classify.ts), so a growing backlog means the redirect check is failing and
 * scripts/verify-shorts.ts is not catching up — which is how 64K unverified clips polluted
 * channel baselines on 2026-09-03.
 */
export const SHORTS_UNVERIFIED_WARN = 50;
export const SHORTS_UNVERIFIED_FAIL = 500;

export function shortsUnverifiedStatus(n: number): CheckStatus {
  if (n > SHORTS_UNVERIFIED_FAIL) return 'fail';
  if (n > SHORTS_UNVERIFIED_WARN) return 'warn';
  return 'ok';
}

/** Recent short-enough uploads that nobody has asked YouTube about yet. */
export const SHORTS_UNVERIFIED_SQL = `
  select count(*)::int as n from videos
  where published_at > now() - interval '7 days'
    and shorts_checked_at is null
    and duration ~ '^PT[0-9HMS]+$'
    and extract(epoch from duration::interval) <= ${SHORT_MAX_SECONDS}`;

/**
 * Rows/day for the three measurement tables, so a pipeline change that quietly stops writing
 * (or starts writing far too much) is visible on the dashboard.
 *
 * rss_samples is the one with a ceiling: the RSS poller reads the free view counts of 15 feed
 * entries for every channel every 15 minutes. Before the change-based dedupe it wrote ~67K
 * rows/hour (441K on 2026-09-03, ~200 MB/day) — mostly repeats of the count stored a tick
 * earlier. With shouldStoreSample (lib/rss/poll-policy.ts) a steady state past 500K/day means
 * the dedupe or its snapshot-phase lookup has regressed.
 */
export const RSS_SAMPLES_PER_DAY_WARN = 500_000;

export function rssSamplesPerDayStatus(n: number): CheckStatus {
  return n > RSS_SAMPLES_PER_DAY_WARN ? 'warn' : 'ok';
}

/** A measurement table that has written nothing today is a stalled job, not a quiet one. */
export function rowsPerDayStatus(n: number): CheckStatus {
  return n > 0 ? 'ok' : 'warn';
}

/** Rows written today, per measurement table. No parameters. */
export const ROWS_PER_DAY_SQL = `
  select 'view_samples' as table_name,
         (select count(*)::bigint from view_samples where sampled_at >= current_date) as n
  union all
  select 'view_snapshots',
         (select count(*)::bigint from view_snapshots where snapshot_date = current_date)
  union all
  select 'rss_samples',
         (select count(*)::bigint from rss_samples where at >= current_date)`;
