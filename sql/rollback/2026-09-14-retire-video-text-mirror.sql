-- Rollback for sql/2026-09-14-retire-video-text-mirror.sql — reinstates the mirror trigger
-- exactly as sql/2026-09-08-video-text.sql defined it.
--
-- DO NOT APPLY THIS WHILE A NULL-OUT IS IN FLIGHT OR PENDING. The trigger fires on the
-- null-out's UPDATE and overwrites video_text with NULLs. scripts/null-video-text.ts refuses to
-- start while it exists, and that refusal is not overridable by --force.
begin;

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

commit;
