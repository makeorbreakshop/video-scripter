-- The /app/channels sparkline lane, materialised (lib/app/channel-sparklines.ts).
-- Rebuilt nightly by scripts/refresh-sparklines.ts; filled on first read for a channel with none.
alter table channel_stats add column if not exists spark jsonb;
alter table channel_stats add column if not exists spark_at timestamptz;
