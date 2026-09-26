-- Rebuild the llm_summary indexes (online). Definitions as they were on 2026-09-26.
set lock_timeout = '5s';
create index concurrently if not exists idx_videos_id_llm_summary on public.videos using btree (id, llm_summary);
create index concurrently if not exists idx_videos_llm_summary_null on public.videos using btree (id) where (llm_summary is null);
create index concurrently if not exists idx_videos_llm_summary_status on public.videos using btree (llm_summary_generated_at, llm_summary_embedding_synced) where (llm_summary is not null);
