-- Owner-only audience evidence. No REST grants: all access uses direct Postgres.
create table if not exists channel_audience (
  channel_id text not null,
  dimension text not null check (dimension in ('age_gender','country','device','traffic_source','subscribed_status')),
  key text not null,
  value numeric not null,
  window_days integer not null check (window_days > 0),
  window_end date not null,
  fetched_at timestamptz not null default now(),
  primary key (channel_id, dimension, key, window_end)
);

create table if not exists audience_comments (
  comment_id text primary key,
  video_id text not null,
  channel_id text not null,
  parent_id text,
  author_hash text not null,
  text text not null,
  like_count integer not null default 0,
  published_at timestamptz not null,
  fetched_at timestamptz not null default now(),
  mined_at timestamptz
);
create index if not exists audience_comments_channel_mined on audience_comments (channel_id, mined_at);
create index if not exists audience_comments_video on audience_comments (video_id);

create table if not exists audience_observations (
  id bigserial primary key,
  channel_id text not null,
  comment_id text not null references audience_comments(comment_id),
  video_id text not null,
  type text not null check (type in ('question','frustration','desire','identity','tool_ownership','request','praise','objection')),
  quote text not null check (char_length(quote) between 1 and 200),
  summary text not null,
  confidence numeric not null check (confidence between 0 and 1),
  theme_id bigint,
  created_at timestamptz not null default now(),
  unique (comment_id, type, quote)
);
create index if not exists audience_observations_channel_type on audience_observations (channel_id, type);

create table if not exists audience_themes (
  id bigserial primary key,
  channel_id text not null,
  profile_version integer not null,
  type text not null check (type in ('question','frustration','desire','identity','tool_ownership','request','praise','objection')),
  label text not null,
  description text not null,
  observation_count integer not null check (observation_count >= 2),
  sample_observation_ids bigint[] not null,
  created_at timestamptz not null default now()
);
create index if not exists audience_themes_channel_version on audience_themes (channel_id, profile_version);

create table if not exists audience_profile (
  channel_id text not null,
  version integer not null,
  name text,
  sections jsonb not null,
  stated jsonb not null default '{}'::jsonb,
  built_at timestamptz not null default now(),
  primary key (channel_id, version)
);

-- Explicitly deny API roles; the owner server path connects as postgres.
revoke all on channel_audience, audience_comments, audience_observations, audience_themes, audience_profile from anon, authenticated, service_role;
revoke all on sequence audience_observations_id_seq, audience_themes_id_seq from anon, authenticated, service_role;
