-- Local pipeline DB (docs/plans/2026-11-20-local-pipeline-db.md), applied after the schema-only
-- restore of Supabase's public schema. The readings trigger chain stays as it is
-- (enqueue_observation_changes, rss_latest_*, queue_*, refresh_day30_truth, gate_series_marks,
-- queue_new_video_bootstraps, sync_video_view_count, update_view_tracking_priority_on_video_update).
-- Dropped here: triggers whose only job is a Supabase-side concern.
--   capture_mirror_changes          feeds the export-tables SQLite mirrors; the local DB IS the mirror
--   track_semantic_content_change   Qdrant sync bookkeeping, owned by Supabase's videos
--   calculate_baseline_on_insert    legacy baseline on Supabase's videos insert
--   sync_institutional_on_video_insert   Supabase-side institutional tables
do $$
declare r record;
begin
  for r in
    select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
     join pg_proc p on p.oid = t.tgfoid
     where not t.tgisinternal and c.relnamespace = 'public'::regnamespace
       and p.proname in ('capture_mirror_changes','track_semantic_content_change',
                         'calculate_baseline_on_insert','sync_institutional_on_video_insert')
  loop
    execute format('drop trigger %I on public.%I', r.tgname, r.relname);
  end loop;
end $$;

-- Foreign keys into Supabase's auth schema: the local copy of videos is a replica, not an app table.
do $$
declare r record;
begin
  for r in select conrelid::regclass as tbl, conname from pg_constraint
            where contype = 'f' and confrelid::regclass::text like 'auth.%'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

-- Pipeline tables must accept rows for videos the replica has not caught up with yet (it is
-- refreshed from the export mirror, up to a day behind). Supabase keeps enforcing the real FK.
-- 2026-11-20: the first shadow tick could not mark ~1,000 new videos per chunk in series_dirty.
do $$
declare r record;
begin
  for r in select conrelid::regclass as tbl, conname from pg_constraint
            where contype = 'f' and confrelid = 'public.videos'::regclass
              and conrelid::regclass::text in ('obs_cache_dirty','observation_change_log','score_dirty','series_dirty',
                'video_day30_truth','video_obs_cache','view_snapshots','view_tracking_priority')
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

-- The replica is filled from the export mirror's projection (scripts/pipeline-load.ts mirror),
-- which does not carry app-only columns. user_id is the one of those that is NOT NULL upstream.
alter table public.videos alter column user_id drop not null;

insert into public.observation_materialization_meta default values on conflict do nothing;
insert into public.series_publication (singleton, marks_enabled) values (true, true) on conflict do nothing;
