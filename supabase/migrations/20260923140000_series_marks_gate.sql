-- series_dirty has no reader while SERIES_HYBRID=1: scripts/rebuild-series.ts --drain exits
-- before any read, so every observation statement upserted into a write-only queue (142K rows,
-- oldest 4.7 d on 2026-09-23). Gate marks on a flag instead of editing enqueue_observation_changes
-- (a concurrent rewrite of that function is in flight). A BEFORE INSERT trigger returning NULL
-- skips the row entirely, including the ON CONFLICT path, for the triggers and channels.ts alike.
-- To resume R2 publication: update series_publication set marks_enabled=true, then run a
-- bounded repair (rebuild-series.ts --all --limit N) since marks were not kept meanwhile.
begin;
set local lock_timeout = '5s';

create table if not exists public.series_publication (
  singleton boolean primary key default true check (singleton),
  marks_enabled boolean not null default false,
  changed_at timestamptz not null default now()
);
insert into public.series_publication(singleton, marks_enabled) values (true, false)
on conflict do nothing;
alter table public.series_publication enable row level security;
revoke all on table public.series_publication from anon, authenticated;

create or replace function public.gate_series_marks()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if coalesce((select marks_enabled from public.series_publication where singleton), true) then
    return new;
  end if;
  return null;
end $$;
revoke execute on function public.gate_series_marks() from public, anon, authenticated;

drop trigger if exists gate_series_marks on public.series_dirty;
create trigger gate_series_marks before insert on public.series_dirty
  for each row execute function public.gate_series_marks();

truncate public.series_dirty;
commit;
