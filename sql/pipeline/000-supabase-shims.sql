-- Supabase-only objects the restored public schema refers to (roles in policies, extensions
-- schema, auth.uid()). Local pipeline DB only; see docs/plans/2026-11-20-local-pipeline-db.md.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
create schema if not exists extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $f$ select null::uuid $f$;
create or replace function auth.role() returns text language sql stable as $f$ select 'service_role'::text $f$;
alter database channelsmith_pipeline set search_path = public, extensions;
