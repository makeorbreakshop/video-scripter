-- APPLIED 2026-09-04 (ET), with Brandon's go.
--
-- `trigger_set_video_is_short` fires BEFORE INSERT OR UPDATE OF duration, title, description on
-- `videos` and sets is_short := is_youtube_short(duration, title, description), which is TRUE for
-- any duration <= 180 s or any title/description containing #shorts. That is the pre-2024 Shorts
-- rule as a hard database override: it discards the verdict every ingest path just obtained from
-- YouTube's own /shorts/<id> routing (lib/ingest/classify.ts -> lib/thumbs/shorts.ts), so a
-- 61-180 s long-form video is inserted as a Short while the application writes
-- shorts_checked_at = now() next to it. lib/scoring/longform.ts trusts a stamped row, so the
-- video is excluded from every baseline and never re-checked.
--
-- Measured 2026-09-04 (ET): of the 2,000 most recently stamped 61-180 s is_short rows, 1,369
-- (68 %) are actually long-form (303 -> /watch); among rows inserted within the last few hours it
-- is ~100 %. The trigger also fires on UPDATE OF title/description, so a title-change stamp can
-- silently flip an already-verified long-form video back to Short.
--
-- The rule now lives in exactly one place: lib/ingest/classify.ts + lib/thumbs/shorts.ts.
drop trigger if exists trigger_set_video_is_short on public.videos;

-- set_video_is_short() is dropped with its trigger: it has exactly one caller and its only job is
-- the override above.
drop function if exists public.set_video_is_short();

-- is_youtube_short(duration, title, description) is KEPT. It is still referenced by three legacy
-- read-side functions — process_baseline_batch, calculate_rolling_baselines_batch and
-- get_packaging_performance — where it is a filter, not a source of truth. Those belong to the
-- pre-v3 temporal-baseline path (no caller in app/ or lib/); dropping the function would break
-- them, so it stays until they do. Nothing may use it to WRITE videos.is_short again.

-- Rollback (restores the 2026-09-04 behaviour exactly; do not run without a reason):
--   create or replace function public.set_video_is_short() returns trigger
--     language plpgsql set search_path to 'pg_catalog','public','extensions' as $fn$
--     begin
--       new.is_short := is_youtube_short(new.duration, new.title, new.description);
--       return new;
--     end;
--   $fn$;
--   create trigger trigger_set_video_is_short
--     before insert or update of duration, title, description on public.videos
--     for each row execute function set_video_is_short();
