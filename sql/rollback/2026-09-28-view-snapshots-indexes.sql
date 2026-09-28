set statement_timeout = '30min';
create index concurrently if not exists idx_view_snapshots_video_date_desc on public.view_snapshots
  using btree (video_id, snapshot_date desc) include (view_count, like_count, comment_count);
create unique index concurrently if not exists view_snapshots_video_id_snapshot_date_key_idx on public.view_snapshots (video_id, snapshot_date);
alter table public.view_snapshots add constraint view_snapshots_video_id_snapshot_date_key unique using index view_snapshots_video_id_snapshot_date_key_idx;
