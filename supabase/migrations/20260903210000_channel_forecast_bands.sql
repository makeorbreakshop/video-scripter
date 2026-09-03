-- Per-channel forecast bands: how wrong this channel's day-30 forecast has been, by the age of
-- the last measurement. The global fit (score_params.params.bands) is the prior; this is the
-- channel's own answer, and lib/scoring/bands.ts shrinkToGlobal blends the two by n.
--
-- One row per (channel, age bucket). Quantiles are of log(actual day-30 / forecast made at that
-- age), so they are added to the log forecast and exponentiated. n is the channel's own count
-- BEFORE shrinkage, kept so the page can say how much of this is the channel and how much the
-- corpus. Written by scripts/fit-forecast-bands.ts.
create table if not exists channel_forecast_bands (
  channel_id text        not null,
  age_bucket real        not null,
  n          integer     not null default 0,
  q10        double precision not null,
  q25        double precision not null,
  q50        double precision not null,
  q75        double precision not null,
  q90        double precision not null,
  fitted_at  timestamptz not null default now(),
  primary key (channel_id, age_bucket)
);

comment on table channel_forecast_bands is
  'Per-channel day-30 forecast error quantiles by last-measurement age; already shrunk toward the global fit (lib/scoring/bands.ts shrinkToGlobal, w = n/(n+8)).';
