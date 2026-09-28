-- view_snapshots: one unique covering index instead of two btrees on (video_id, snapshot_date).
-- The unique constraint (137 MB, the ON CONFLICT arbiter) and idx_view_snapshots_video_date_desc
-- (220 MB, the index-only latest-snapshot reads) key the same columns; a unique btree with the
-- INCLUDE columns serves both (a btree scans backwards for DESC). idx_view_snapshots_date stays
-- (the daily rollup, 2026-09-14). Every insert touched six indexes; now five. Session pooler:
--   psql "$DATABASE_SESSION_URL" -v ON_ERROR_STOP=1 -f sql/2026-09-28-view-snapshots-indexes.sql
-- Rollback: sql/rollback/2026-09-28-view-snapshots-indexes.sql
set statement_timeout = '30min';
set lock_timeout = '5min';
create unique index concurrently if not exists view_snapshots_video_date_uniq
  on public.view_snapshots (video_id, snapshot_date) include (view_count, like_count, comment_count);
-- The constraint drop takes ACCESS EXCLUSIVE for an instant; never queue behind a long reader.
set lock_timeout = '5s';
alter table public.view_snapshots drop constraint if exists view_snapshots_video_id_snapshot_date_key;
set lock_timeout = '5min';
drop index concurrently if exists public.idx_view_snapshots_video_date_desc;
