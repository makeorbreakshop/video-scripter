-- Rollback for sql/2026-09-14-drop-redundant-indexes.sql. Exact original definitions, taken from
-- pg_get_indexdef() before the drop. CONCURRENTLY so the rebuild blocks nothing; on a 271 MB /
-- 103 MB heap each takes a few minutes and must not run inside a transaction block.
create index concurrently if not exists idx_view_snapshots_video_date
  on public.view_snapshots using btree (video_id, snapshot_date desc);

create index concurrently if not exists idx_view_tracking_priority_tier_date
  on public.view_tracking_priority using btree (priority_tier, next_track_date)
  include (video_id, last_tracked) where (next_track_date is not null);
