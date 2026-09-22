-- Packaging angle taxonomy: the closed enum a video's title and thumbnail are labelled against,
-- and the labels themselves. Owner-only surface (/app/angles); no REST grants, all access is
-- direct Postgres (lib/admin/db.ts) — never supabase-js (2026-08-31 org-wide egress incident).
--
-- An "angle" is the framing of a subject in the packaging, independent of the subject and of the
-- spoken hook. Families group angles. Two kinds, because a title angle and a thumbnail angle are
-- read off different surfaces and a video carries both at once.
--
-- Idempotent: safe to re-run.

create table if not exists angle_families (
  id text primary key,
  label text not null,
  surface text not null check (surface in ('title', 'thumbnail')),
  position integer not null default 0
);

create table if not exists angles (
  id text primary key,
  family_id text not null references angle_families(id),
  kind text not null check (kind in ('title', 'thumbnail')),
  label text not null,
  definition text not null,
  taxonomy_version integer not null default 1,
  active boolean not null default true
);
create index if not exists angles_family on angles (family_id, id);

create table if not exists video_angles (
  video_id text not null,
  angle_id text not null references angles(id),
  kind text not null check (kind in ('title', 'thumbnail')),
  confidence numeric,
  variation text,
  model text,
  taxonomy_version integer not null default 1,
  tagged_at timestamptz not null default now(),
  primary key (video_id, angle_id)
);
-- The board reads one angle at a time, newest first; the tagger asks "is this video done yet".
create index if not exists video_angles_angle_tagged on video_angles (angle_id, tagged_at desc);
create index if not exists video_angles_video on video_angles (video_id);

create table if not exists angle_tag_runs (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  videos integer not null default 0,
  requests integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  usd numeric not null default 0,
  model text,
  notes text
);
