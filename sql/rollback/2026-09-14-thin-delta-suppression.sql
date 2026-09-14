-- Rollback for supabase/migrations/20260914140000_thin_delta_suppression.sql.
-- Restores the delete triggers to their 2026-09-11 form (no suppression check). The ledger
-- columns are left in place — they are additive, nothing reads them once the code is reverted,
-- and dropping them would lose the record of what has already been thinned.
begin;

create or replace function public.queue_rss_deletes()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform public.enqueue_observation_changes((select jsonb_agg(jsonb_build_object(
    'video_id',video_id,'source','rss','operation','delete','at',at)) from old_rows));
  return null;
end $$;

create or replace function public.queue_sample_deletes()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform public.enqueue_observation_changes((select jsonb_agg(jsonb_build_object(
    'video_id',video_id,'source','sample','operation','delete','at',sampled_at)) from old_rows));
  return null;
end $$;

drop function if exists public.thin_deltas_suppressed();

commit;
