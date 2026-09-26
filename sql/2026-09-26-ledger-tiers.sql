-- Allow the 2026-09-26 thinning policy labels in the archive ledger (lib/readings/chain.ts ledgerTier).
begin;
set local lock_timeout = '5s';
alter table readings_archive_days drop constraint if exists readings_archive_days_thinned_tier_check;
alter table readings_archive_days add constraint readings_archive_days_thinned_tier_check
  check (thinned_tier is null or thinned_tier in ('hour','day','day-v2','week-v2'));
commit;
