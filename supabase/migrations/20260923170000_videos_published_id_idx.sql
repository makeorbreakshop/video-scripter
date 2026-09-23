-- launch-track enrollment (lib/nightly/launch-enroll.ts) finds unenrolled recent videos with an
-- index-only range scan on this index, instead of reading ~86K videos heap rows every 5 minutes
-- (~400 MB of cold reads per run, measured 2026-09-23). Apply with psql, outside a transaction.
set statement_timeout = '15min';
create index concurrently if not exists videos_published_id_idx
  on public.videos (published_at) include (id);
reset statement_timeout;
