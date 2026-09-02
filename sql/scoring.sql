-- Model v3 scoring storage (2026-09-02). Additive; nothing here touches videos.
-- Applied with: psql "$DATABASE_URL" -f sql/scoring.sql

-- Fitted global parameters, one row per fit (latest wins).
create table if not exists score_params (
  id            bigserial primary key,
  model_version text not null,
  fitted_at     timestamptz not null default now(),
  n_videos      integer not null,
  params        jsonb not null
);

-- One row per scored video, rewritten each time the video gets a newer snapshot.
create table if not exists video_scores (
  video_id        text primary key,
  channel_id      text,
  model_version   text not null,
  scored_at       timestamptz not null default now(),
  snapshot_day    real not null,          -- true age (days) of the snapshot used
  views           integer not null,
  q               real,                   -- video's own growth exponent (null with <2 snapshots)
  est30           double precision not null,
  baseline        double precision,       -- median day-30 views of last <=10 priors
  n_baseline      integer not null default 0,
  score           double precision,       -- est30 / baseline
  same_age_ratio  double precision,       -- views / median prior views at same age
  n_same_age      integer not null default 0,
  confidence      text not null check (confidence in ('insufficient','early','likely','confirmed'))
);
create index if not exists idx_video_scores_score on video_scores (score desc nulls last);
create index if not exists idx_video_scores_ratio on video_scores (same_age_ratio desc nulls last);
create index if not exists idx_video_scores_channel on video_scores (channel_id, scored_at desc);

-- 2026-09-02: baselines may now be built from lifetime counts normalized down the
-- long-tail curve when a prior has no day-27..33 snapshot. Track how many did.
alter table video_scores add column if not exists priors_from_lifetime integer not null default 0;
