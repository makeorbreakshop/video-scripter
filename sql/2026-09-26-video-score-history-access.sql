-- Close video_score_history (parent, every partition, default) and video_scores_by_version to the
-- public API roles. Every caller is direct Postgres as postgres / service_role / channelsmith_app,
-- all of which bypass RLS (checked 2026-09-26: no supabase-js or client reference anywhere).
begin;
set local lock_timeout = '5s';
do $$
declare r record;
begin
  for r in select c.oid::regclass as rel from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r','p')
              and (c.relname = 'video_score_history' or c.relname like 'video\_score\_history\_p%'
                   or c.relname = 'video_score_history_default')
  loop
    execute format('alter table %s enable row level security', r.rel);
    execute format('revoke all on %s from anon, authenticated', r.rel);
  end loop;
end $$;
revoke all on public.video_scores_by_version from anon, authenticated;
commit;
