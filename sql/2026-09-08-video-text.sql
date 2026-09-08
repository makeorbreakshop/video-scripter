-- video_text: the three wide columns off the hot table.
--
-- `videos` is 4 GB against a 512 MB buffer pool, and description + metadata are 86% of the row.
-- Every page that joins videos — the feed, the channel grid, the channel list — pays for those
-- bytes on every heap fetch and never reads them: a feed page of 50 rows touched 2,281 shared
-- blocks (measured 2026-09-08) almost entirely to skip past text nobody rendered.
--
-- This creates the side table and moves the data. It does NOT drop or null the originals: the
-- readers are switched first and verified against both, and the null-out plus VACUUM FULL is a
-- separate, later change (see docs/runbooks/2026-09-08-site-speed.md). Until then this table is
-- pure addition and nothing depends on it.
create table if not exists video_text (
  video_id    text primary key,
  description text,
  metadata    jsonb,
  llm_summary text,
  moved_at    timestamptz not null default now()
);

comment on table video_text is
  'The wide, rarely-read columns of `videos`. Accessor: lib/app/video-text.ts. Filled by '
  'scripts/move-video-text.ts. videos.description/metadata/llm_summary are still authoritative '
  'until the null-out migration runs.';

-- KEEPING THE COPY TRUE: a trigger, not 176 edited call sites.
--
-- description/metadata/llm_summary are written from five ingest scripts and read from dozens of
-- legacy routes, several of them through supabase-js where there is no shared query to edit. A
-- mirror trigger is one place, it cannot be forgotten by a new writer, and it makes "the two
-- copies agree" an invariant rather than a thing to re-verify after every change — which is the
-- precondition for ever nulling the originals.
--
-- It fires only when one of the three columns actually changed, so the ordinary ingest update
-- (view counts, is_short, updated_at) pays nothing but the WHEN evaluation.
create or replace function video_text_mirror() returns trigger language plpgsql as $$
begin
  insert into video_text (video_id, description, metadata, llm_summary, moved_at)
  values (new.id, new.description, new.metadata, new.llm_summary, now())
  on conflict (video_id) do update
     set description = excluded.description, metadata = excluded.metadata,
         llm_summary = excluded.llm_summary, moved_at = excluded.moved_at;
  return new;
end $$;

drop trigger if exists video_text_mirror_ins on videos;
create trigger video_text_mirror_ins after insert on videos
  for each row execute function video_text_mirror();

drop trigger if exists video_text_mirror_upd on videos;
create trigger video_text_mirror_upd after update on videos
  for each row
  when (old.description is distinct from new.description
     or old.metadata is distinct from new.metadata
     or old.llm_summary is distinct from new.llm_summary)
  execute function video_text_mirror();
