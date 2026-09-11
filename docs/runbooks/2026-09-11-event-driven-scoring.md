# Event-driven observation and scoring rollout

This replaces routine raw-history unions with three bounded queues: observation deltas are folded
into one compact format-2 row per video, due scores read only those clean rows, and R2 series files
are rebuilt from the same projection. Raw fallback budget: zero for both scheduled scoring and R2
drains.

## Invariants

- Capture first. The database migration must be committed before any v2 bootstrap starts.
- Scheduled materialization is capped at 20,000 videos, 50,000 deltas, 25 MB cache input, and
  25 MB compressed output per run.
- Scheduled scoring is capped at 1,000 targets, in pages of 100, and cannot query raw history on a
  cache miss. A miss is deferred and re-queued for materialization.
- Scheduled R2 drains preflight each compact-state chunk in Postgres and stop before returning
  more than 25 MB of cache payload in one run.
- Queue rows clear only when their exact claimed generation is still current. A concurrent write
  always survives.
- Bootstrap prefers R2. A pre-cutover R2 file is accepted only when a server-side latest-write
  timestamp proves it contains all pre-capture source rows. Raw history requires explicit video
  and row budgets and is counted before it is selected.

## Activation order

Do this as a supervised deployment; the commands below are intentionally not run by tests.

1. Stop the legacy hourly scorer and the three legacy series/cache agents. Keep RSS and sample
   ingestion running unless a quiet cutover window is available.
2. Apply `supabase/migrations/20260911153000_event_driven_scoring.sql`. Confirm the singleton
   `capture_started_at`, ten statement-level triggers, and empty/advancing queues.
3. Run `npm run observations:health`. Observe at least one real ingest cycle and confirm
   `observation_change_log`, `obs_cache_dirty`, `score_dirty`, and `series_dirty` move together.
4. Bootstrap existing rows R2-first in bounded batches. Start with a dry run, then repeat the
   smallest successful batch. Do not add raw budgets until the R2-safe population is understood:

   ```bash
   npm run observations:bootstrap -- --dry-run --max-videos 25
   npm run observations:bootstrap -- --max-videos 25 --raw-video-budget 25 --raw-row-budget 100000
   ```

5. Run the materializer manually once, then install the generated LaunchAgents. The installer
   writes definitions only; bootout/bootstrap the changed labels so launchd loads them:

   ```bash
   npm run observations:materialize -- --dry-run
   npm run launchd:install
   ```

6. Canary the queue-driven scorer with `npm run scores:drain -- --limit 100`, inspect score
   parity/history, then allow its generated five-minute agent to run at the 1,000 target cap.
7. Run `npm run series:drain -- --dry-run`, then enable the generated ten-minute series agent.
   There is no nightly full-corpus rewrite.

## Verification and stop conditions

`npm run observations:health` returns one JSON object. Stop rollout if clean observation work is
older than 15 minutes, due scoring is older than 15 minutes, series work is older than 30 minutes,
or the delta log exceeds 100,000 rows. Also stop if any scheduled scorer logs a raw-union fallback,
a format-2 parity sample differs from a direct raw read, or Supabase egress does not flatten after
two complete poll/materialize/score cycles.

Every pipeline transaction sets a stable `application_name` beginning with `video-scripter:` so
the component is visible in Supabase Postgres logs and `pg_stat_activity` while its query runs.
This must be transaction-local: a live acceptance test showed the Shared Pooler reports
`Supavisor` when only the client startup field is set. Each worker also emits newline-delimited
JSON with `type: "supabase.query"`, a per-run `trace_id`, a redacted operation name, duration, row
count, and `estimated_response_bytes`. The estimate counts returned values (not protocol framing),
so use it as a comparable lower bound rather than a billing meter. No SQL text, bind values, URLs,
or credentials are logged. A final `type: "supabase.run"` record totals the run and includes
pipeline-specific cache/row/file counters.

For a canary, group the structured records by `trace_id` and confirm that scheduled scorer spans
include `score.queue-targets` and `observation.cache-read`, never a raw observation operation.
Correlate the same time window with the `video-scripter:score-videos` application in Supabase
Postgres/Supavisor logs. Direct Postgres has no W3C HTTP trace header; the shared run id in local
structured logs plus component/timestamps in Supabase is the deliberate correlation boundary.

The default `npm test` run excludes database/external-service integration suites. A production
parity run must be targeted explicitly and, for suites capable of refreshing derived DB/R2 state,
must also set `ALLOW_PRODUCTION_INTEGRATION_TESTS=1`. The event-materialization integration suite
accepts only `EVENT_MATERIALIZATION_TEST_DATABASE_URL` pointing at localhost.

Model-wide changes use `npm run scores:rollout -- --version <version> --limit 5000` and the returned
keyset cursor. They never turn the recurring scorer into a corpus scan.
Direct `--final`, `--since`, `--all --force`, and `--v5` scorer modes require an explicit limit and
reject values above 5,000.

## Rollback

Boot out the three new agents first. Restore the previous application revision before running
`sql/rollback/2026-09-11-event-driven-scoring.sql`; the old scorer does not understand removal of
the v2 queue tables. The rollback removes capture triggers/functions and new queue state but does
not delete raw observations, scores, R2 series files, or the existing `video_obs_cache` rows.
