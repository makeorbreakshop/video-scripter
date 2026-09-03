-- When the avatar copy for a channel was last written to R2 (avatars/{channel_id}.jpg).
-- Null = not copied yet; scripts/avatar-cache-sync.ts fills it. Re-copied when avatar_url changes.
alter table channel_meta add column if not exists avatar_cached_at timestamptz;
alter table channel_meta add column if not exists avatar_cached_url text;
