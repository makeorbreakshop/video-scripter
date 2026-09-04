-- Append-only score history (2026-09-04, shipped with v5.0).
-- Applied with: psql "$DATABASE_URL" -f sql/score-history.sql
--
-- WHY. `video_scores` is one row per video with no version dimension: a rescore overwrites the
-- previous answer and there is no way back. That is what made the v5 rescore a one-way door, and
-- it is what makes the ~95K `v3.1-semantic-backfill-2026-09` rows -- which the semantic eval
-- reads by that exact label -- disappear the moment v5 rewrites them. This table keeps every
-- score ever written, so `video_scores` stays "the current answer" and history stays queryable
-- by model_version.
--
-- Nothing here is ever updated or deleted. One row per (video, write).

create table if not exists video_score_history (
  id                     bigserial primary key,
  video_id               text not null,
  channel_id             text,
  model_version          text not null,
  scored_at              timestamptz not null default now(),
  age_days               double precision,
  views                  bigint,
  score                  double precision,
  same_age_ratio         double precision,
  typical_at_age         double precision,
  n_typical              integer,
  typical_measured_share double precision,
  projection             double precision,
  projection_horizon     double precision,
  est30                  double precision,
  baseline               double precision,
  n_baseline             integer,
  confidence             text,
  -- anything else the written row carried (q, n_same_age, typical_neff, priors_from_lifetime,
  -- and whatever a later model adds) so a schema change never loses provenance.
  extra                  jsonb
);

create index if not exists idx_vsh_video_scored on video_score_history (video_id, scored_at desc);
create index if not exists idx_vsh_version_scored on video_score_history (model_version, scored_at);

comment on table video_score_history is 'Append-only log of every score ever written. video_scores holds the current answer; this holds the record.';

-- The semantic eval pins the score corpus to one model_version label. It used to read
-- video_scores directly, which only worked while nothing had rescored over it. This view is the
-- latest history row per (video, version) -- exactly what video_scores held at the time.
create or replace view video_scores_by_version as
  select distinct on (h.video_id, h.model_version) h.*
    from video_score_history h
   order by h.video_id, h.model_version, h.scored_at desc;

comment on view video_scores_by_version is 'Latest history row per (video_id, model_version). Read this, not video_scores, when you need a specific model version.';
