-- Additive, no source backfill or deletion. Capture BEFORE admitting a bootstrap mirror.
CREATE SEQUENCE IF NOT EXISTS public.mirror_generation_seq;
CREATE TABLE IF NOT EXISTS public.mirror_registry (
 dataset text PRIMARY KEY, epoch text NOT NULL DEFAULT gen_random_uuid()::text,
 owner text, checkpoint text, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mirror_registry ADD COLUMN IF NOT EXISTS checkpoint text;
CREATE TABLE IF NOT EXISTS public.mirror_dirty (
 dataset text NOT NULL REFERENCES public.mirror_registry(dataset), key text NOT NULL,
 generation bigint NOT NULL DEFAULT nextval('public.mirror_generation_seq'),
 claimed boolean NOT NULL DEFAULT false, marked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(dataset,key)
);
ALTER TABLE public.mirror_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mirror_dirty ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mirror_registry,public.mirror_dirty FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.mirror_generation_seq FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.capture_mirror_changes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE row_fields text; change_sql text; keys text[]; source_filter text:=''; at_sql text;
BEGIN
 IF TG_OP='TRUNCATE' THEN
  UPDATE public.mirror_registry SET epoch=gen_random_uuid()::text WHERE dataset=TG_ARGV[0];
  RETURN NULL;
 END IF;
 IF TG_ARGV[0]='launch-fit' AND TG_TABLE_NAME IN ('view_samples','view_snapshots') THEN
  at_sql:=CASE TG_TABLE_NAME WHEN 'view_samples' THEN 'src.sampled_at' ELSE '(src.snapshot_date::timestamptz + interval ''12 hours'')' END;
  source_filter:=format(' WHERE src.view_count>0 AND EXISTS(SELECT 1 FROM public.videos v WHERE v.id=src.video_id AND %1$s>v.published_at AND %1$s<=v.published_at+interval ''27 hours'')',at_sql);
 END IF;
 SELECT string_agg(format('%I',trim(f)),',') INTO row_fields FROM unnest(string_to_array(TG_ARGV[2],',')) f;
 IF TG_OP='INSERT' THEN
  change_sql:=format('select distinct %I::text from new_rows src%s',TG_ARGV[1],source_filter);
 ELSIF TG_OP='DELETE' THEN
  change_sql:=format('select distinct %I::text from old_rows src%s',TG_ARGV[1],source_filter);
 ELSE
  -- EXCEPT ALL preserves duplicate source observations. Include the entity key even if
  -- projection fields do not; a key move queues both the deletion and the insertion.
  change_sql:=format('select distinct key from (
   (select %1$I::text key,ROW(%2$s)::text body from old_rows src%3$s EXCEPT ALL select %1$I::text,ROW(%2$s)::text from new_rows src%3$s)
   UNION ALL
   (select %1$I::text key,ROW(%2$s)::text body from new_rows src%3$s EXCEPT ALL select %1$I::text,ROW(%2$s)::text from old_rows src%3$s)
  ) changed',TG_ARGV[1],row_fields,source_filter);
 END IF;
 EXECUTE 'select array_agg(key order by key) from ('||change_sql||') k(key) where key is not null' INTO keys;
 IF keys IS NOT NULL THEN
  INSERT INTO public.mirror_dirty(dataset,key)
  SELECT TG_ARGV[0],k FROM unnest(keys) k ORDER BY k
  ON CONFLICT(dataset,key) DO UPDATE SET generation=excluded.generation,
    claimed=false,marked_at=excluded.marked_at
  WHERE mirror_dirty.claimed;
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.capture_mirror_changes() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.install_mirror_capture(dataset text,source_table text,entity_key text,fields text)
RETURNS void LANGUAGE plpgsql SET search_path TO pg_catalog,public AS $$
DECLARE op text; name text; reference text;
BEGIN
 INSERT INTO public.mirror_registry(dataset) VALUES(dataset) ON CONFLICT DO NOTHING;
 FOREACH op IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
  name:='mirror_'||replace(dataset,'-','_')||'_'||lower(op);
  reference:=CASE op WHEN 'INSERT' THEN 'NEW TABLE AS new_rows' WHEN 'DELETE' THEN 'OLD TABLE AS old_rows' ELSE 'OLD TABLE AS old_rows NEW TABLE AS new_rows' END;
  EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I',name,source_table);
  EXECUTE format('CREATE TRIGGER %I AFTER %s ON public.%I REFERENCING %s FOR EACH STATEMENT EXECUTE FUNCTION public.capture_mirror_changes(%L,%L,%L)',name,op,source_table,reference,dataset,entity_key,fields);
 END LOOP;
 name:='mirror_'||replace(dataset,'-','_')||'_truncate';
 EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I',name,source_table);
 EXECUTE format('CREATE TRIGGER %I AFTER TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.capture_mirror_changes(%L,%L,%L)',name,source_table,dataset,entity_key,fields);
END $$;
REVOKE ALL ON FUNCTION public.install_mirror_capture(text,text,text,text) FROM PUBLIC;

-- Fixture databases may install just the generic capture on their own table.
DO $$ BEGIN
 IF to_regclass('public.videos') IS NOT NULL THEN
  PERFORM public.install_mirror_capture('videos','videos','id','id,channel_id,channel_name,title,published_at,view_count,duration,is_short,is_institutional,privacy_status,shorts_checked_at,format_type,topic_niche');
  PERFORM public.install_mirror_capture('launch-fit','videos','id','id,published_at,duration,is_short,shorts_checked_at');
 END IF;
 IF to_regclass('public.video_scores') IS NOT NULL THEN
  PERFORM public.install_mirror_capture('video_scores','video_scores','video_id','video_id,channel_id,model_version,scored_at,snapshot_day,views,q,est30,baseline,n_baseline,score,same_age_ratio,n_same_age,confidence,age_days,typical_at_age,n_typical,typical_neff,typical_measured_share,projection,projection_horizon,typical_kind,typical_anchor_age');
 END IF;
 IF to_regclass('public.view_snapshots') IS NOT NULL THEN
  PERFORM public.install_mirror_capture('view_snapshots','view_snapshots','id','id,video_id,snapshot_date,view_count,like_count,comment_count,days_since_published,created_at');
  PERFORM public.install_mirror_capture('launch-fit','view_snapshots','video_id','video_id,snapshot_date,view_count');
 END IF;
 IF to_regclass('public.view_samples') IS NOT NULL THEN
  PERFORM public.install_mirror_capture('launch-fit','view_samples','video_id','video_id,sampled_at,view_count');
 END IF;
END $$;
