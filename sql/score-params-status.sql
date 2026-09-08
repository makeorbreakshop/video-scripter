-- Gated refits (2026-09-08). Applied with: psql "$DATABASE_URL" -f sql/score-params-status.sql
-- Idempotent: safe to run repeatedly.
--
-- WHY. `score_params` was "latest row for this model_version wins". The nightly 04:15 `--fit`
-- inserted a row and that row was live the moment it committed -- no benchmark, no calibration
-- check, no way back except another fit. A refit is a model change; it went out on a schedule
-- with no gate. This adds a status so a fit can exist without being live.
--
--   candidate  freshly fitted, read by nothing except the gates that are judging it
--   active     what the scorer and every app surface read (newest active row wins)
--   rejected   a candidate that failed a gate, kept with its reason
--
-- The default is 'active' precisely so that applying this changes nothing: every row that
-- exists today becomes active, and "newest active for this version" is the same row that
-- "newest for this version" already returned.

alter table score_params add column if not exists status      text not null default 'active';
alter table score_params add column if not exists status_at   timestamptz;
alter table score_params add column if not exists status_note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'score_params_status_check') then
    alter table score_params add constraint score_params_status_check
      check (status in ('candidate', 'active', 'rejected'));
  end if;
end $$;

-- The scorer's hot read: newest active row for a version.
create index if not exists idx_score_params_active
  on score_params (model_version, fitted_at desc) where status = 'active';

comment on column score_params.status is
  'candidate = fitted but not live; active = what the scorer reads; rejected = failed a gate. Promotion happens in scripts/weekly-refit.ts only.';
comment on column score_params.status_note is
  'Why this row is in its current status -- the failing gate for a rejection, the eval id for a promotion.';

-- One row per weekly gate run. The scorecard page reads this; nothing else does.
create table if not exists model_evals (
  id                  bigserial primary key,
  run_at              timestamptz not null default now(),
  model_version       text not null,
  candidate_params_id bigint references score_params(id),
  verdict             text not null check (verdict in ('promoted', 'rejected', 'skipped', 'error')),
  -- one key per gate: {benchmark: {pass, better, worse, wash, worstCell, ...}, calibration: {...}, ...}
  gates               jsonb not null default '{}'::jsonb,
  worst_cell          text,
  notes               text
);
create index if not exists idx_model_evals_run_at on model_evals (run_at desc);

comment on table model_evals is
  'One row per weekly-refit gate run: what was judged, against what, and why it was or was not promoted.';

-- Forecast-vs-outcome scorecard, recomputed by scripts/scorecard-refresh.ts. Append-only:
-- the page reads the newest computed_at per dimension, and the older rows are the trend.
create table if not exists scorecard (
  id          bigserial primary key,
  computed_at timestamptz not null default now(),
  -- WHERE the graded claims came from. `history` is video_score_history -- the scores the app
  -- actually showed -- and is the one that matters; it began 2026-09-02, so the first claims it
  -- can grade against a day-30 outcome arrive around 2026-10-02 and it is empty until then.
  -- `benchmark` replays the real scorer over the archive (docs/benchmarks/*.rows.csv) and is
  -- what the page has to show in the meantime. They are never mixed in one cell.
  source      text not null default 'history',
  dimension   text not null,   -- age | channel_size | confidence | typical_kind | packaging
  bucket      text not null,   -- the label within that dimension
  metrics     jsonb not null   -- n, medALE, bias, precision, recall, f1, calls, truths
);
alter table scorecard add column if not exists source text not null default 'history';
-- Dropped and recreated rather than `if not exists`: the first cut of this file indexed without
-- `source`, and an index that already exists under the right name with the wrong columns is
-- exactly what `if not exists` will not fix.
drop index if exists idx_scorecard_dim;
drop index if exists idx_scorecard_cell;
create index idx_scorecard_dim on scorecard (source, dimension, computed_at desc);
create unique index idx_scorecard_cell on scorecard (computed_at, source, dimension, bucket);

comment on table scorecard is
  'Forecast-vs-outcome: every score written at age t, graded against the day-30 count that actually happened.';
