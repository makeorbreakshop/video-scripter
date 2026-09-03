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
