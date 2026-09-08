-- v5.3: how C(t) was arrived at. Additive and nullable, safe to run before a rescore.
--
-- v5.3 stops returning a null channel curve wherever fewer than three priors were MEASURED at
-- the target age (on most channels, every age under a day: launch sampling began 2026-09-01).
-- It reads the level at the nearest age the channel does have one and slides it along the global
-- growth curve. That is a weaker claim than a measured denominator, so the row has to say which
-- it was -- otherwise a sub-day score and a day-7 score are indistinguishable on disk.
--
-- Apply: psql "$DATABASE_URL" -f sql/scoring-v5-3.sql

alter table video_scores add column if not exists typical_kind       text;
alter table video_scores add column if not exists typical_anchor_age double precision;

comment on column video_scores.typical_kind is
  'measured = >=3 priors had a reading AT this age; estimated = the level was slid here from typical_anchor_age along the global growth curve (v5.3).';
comment on column video_scores.typical_anchor_age is
  'For typical_kind = estimated: the age, in days, at which C was actually measured before being slid to age_days. Null when measured.';

-- video_score_history carries the same two facts in `extra` (jsonb), so no migration is needed
-- there; this index makes "how many estimated rows are there" answerable without a scan.
create index if not exists idx_video_scores_typical_kind on video_scores (typical_kind);
