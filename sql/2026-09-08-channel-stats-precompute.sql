-- Two more materialised per-channel numbers, for the two page reads that still went to `videos`.
--
--   packaging_change_count  the Changes tab's count. Computing it live is a 3-way join over the
--                           channel's whole catalogue — 6,300 shared blocks on a 1,745-video
--                           channel, over half of that page's total cost (measured 2026-09-08).
--   last_upload_at          the channel list's subline. One backward index probe into `videos`
--                           per channel is cheap; 500 of them per render is not.
--
-- Both are null until the next refreshChannelStats run, and both readers treat null as "compute
-- it live", so this migration changes no number at any point.
alter table channel_stats add column if not exists packaging_change_count int;
alter table channel_stats add column if not exists last_upload_at timestamptz;

comment on column channel_stats.packaging_change_count is
  'Videos of this channel with more than one thumbnail or title version, long-form only, no date '
  'range. The one definition is lib/app/packaging-rows.ts changedVideoCountSql.';
comment on column channel_stats.last_upload_at is
  'max(videos.published_at) for the channel. Read by lib/app/channels.ts listUserChannels.';
