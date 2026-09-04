-- The feed's segment chips (Uploads / Tests / Changes / Outliers) filter feed_events by type
-- inside a per-channel probe. Without type in the index every probe read the channel's whole
-- longform history and filtered it: for the 500-channel account the Outliers chip touched
-- 18,906 buffers to return 60 rows, and took 2.3s on a cold cache.
--
-- With (channel_id, type, at desc, id desc) the same page is 1,707 buffers and ~6ms.
-- Partial on is_longform to match idx_feed_events_channel_at_longform and the query's own
-- predicate; ~9 MB at 126k events.
--
-- See docs/perf/2026-09-04-feed-speed-audit.md.
create index concurrently if not exists idx_feed_events_channel_type_at_longform
  on feed_events (channel_id, type, at desc, id desc)
  where is_longform;
