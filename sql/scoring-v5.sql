-- v5.0 scoring columns. NOT APPLIED to production in the v5 build session (2026-09-04):
-- writing them means rewriting video_scores, which is one row per video with no version
-- dimension and no rollback, and that needs Brandon's approval alongside the rescore.
--
-- v5 redefines `score` as the same-age ratio v(t) / C(t) and demotes the day-30 number to a
-- projection at a chosen horizon. The columns below carry what a v5 row needs beyond v4's.
--
-- Apply order: these are all additive and nullable, so the migration is safe to run BEFORE a
-- rescore; the app keeps reading v4 rows until the rescore lands.

alter table video_scores add column if not exists age_days              double precision;
alter table video_scores add column if not exists typical_at_age        double precision;
alter table video_scores add column if not exists n_typical             integer;
alter table video_scores add column if not exists typical_neff          double precision;
alter table video_scores add column if not exists typical_measured_share double precision;
alter table video_scores add column if not exists projection            double precision;
alter table video_scores add column if not exists projection_horizon    double precision;

comment on column video_scores.age_days is 'True age in days at the reading the score was computed from.';
comment on column video_scores.typical_at_age is 'C(t): what a normal video on this channel has at this age (time-weighted log median of prior contributions).';
comment on column video_scores.n_typical is 'Prior videos that contributed to C(t).';
comment on column video_scores.typical_neff is 'Effective prior count after age weighting: (sum w)^2 / sum w^2.';
comment on column video_scores.typical_measured_share is 'Fraction of C(t) contributions that were REAL samples at this age rather than slid along G.';
comment on column video_scores.projection is 'v-hat at projection_horizon days, along G. A separate product from the score.';
comment on column video_scores.projection_horizon is 'Horizon of `projection`, in days. 30 by default, for comparability with v4 est30.';
