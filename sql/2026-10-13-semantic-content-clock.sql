-- Nullable metadata-only addition: no corpus rewrite or backfill.
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS semantic_changed_at timestamptz;
CREATE OR REPLACE FUNCTION public.track_semantic_content_change() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog,public AS $$
BEGIN
 IF TG_OP='INSERT' THEN NEW.semantic_changed_at:=clock_timestamp();
 ELSIF ROW(NEW.title,NEW.description,NEW.channel_name,NEW.channel_id,NEW.topic_domain,
           NEW.topic_niche,NEW.topic_micro,NEW.format_type,NEW.privacy_status,NEW.is_short,
           NEW.duration,NEW.published_at,NEW.is_institutional)
   IS DISTINCT FROM
       ROW(OLD.title,OLD.description,OLD.channel_name,OLD.channel_id,OLD.topic_domain,
           OLD.topic_niche,OLD.topic_micro,OLD.format_type,OLD.privacy_status,OLD.is_short,
           OLD.duration,OLD.published_at,OLD.is_institutional) THEN NEW.semantic_changed_at:=clock_timestamp();
 ELSE
  -- Lazy admission: retain a possibly unprocessed pre-migration edit. Never copy NEW.updated_at,
  -- which may just be a view-count timestamp. Subsequent view writes retain the old content clock.
  NEW.semantic_changed_at:=coalesce(OLD.semantic_changed_at,OLD.updated_at,OLD.published_at);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.track_semantic_content_change() FROM PUBLIC;
DROP TRIGGER IF EXISTS track_semantic_content_change ON public.videos;
CREATE TRIGGER track_semantic_content_change BEFORE INSERT OR UPDATE ON public.videos
FOR EACH ROW EXECUTE FUNCTION public.track_semantic_content_change();
