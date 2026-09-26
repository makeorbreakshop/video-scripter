create index concurrently if not exists idx_videos_competitor_metadata on public.videos using btree (is_competitor, ((metadata ->> 'youtube_channel_id'::text))) where (is_competitor = true);
