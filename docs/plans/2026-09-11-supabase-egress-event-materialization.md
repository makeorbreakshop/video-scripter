---
title: Event-driven scoring materialization with bounded Supabase egress
status: active
artifact_readiness: implementation-ready
execution: code
---

# Event-driven scoring materialization with bounded Supabase egress

## Outcome

Replace the live scorer's corpus scan and raw-history fallback with two bounded, watermark-safe
queues. Observation writes append small deltas in the database transaction that commits the raw
reading. A materializer folds only those deltas into a versioned per-video observation state. The
scorer processes only due `score_dirty` rows and reads compact state exclusively.

The governing invariant is: **normal scoring never returns raw observation-history rows from
Supabase.** Raw histories are allowed only in an explicit, counted bootstrap lane; cold bootstrap,
refits, backtests, and model-wide rollouts prefer R2/Parquet.

## Non-goals and protected behavior

- Do not change v5.4 scoring math, prior selection, confidence rules, observation precedence, or
  the current `video_scores`/`video_score_history` atomic write contract.
- Do not stop or install LaunchAgents, execute production DDL/backfills, deploy, push, or alter the
  Supabase spend cap in this implementation turn.
- Keep RSS/API ingestion available if a derived-state queue is temporarily unhealthy. Once the
  migration is installed, its trigger tables/functions are part of the same transaction and must
  be rollback-safe.
- Keep interactive single-video reads able to use a small explicit raw-miss allowance; batch
  scoring gets an allowance of zero.
- Preserve R2 series-file behavior while separating its invalidation queue from score state.

## Prior Learnings

- The Sep 11 production scorer performed 2.3M cache lookups at a 98%+ miss rate and silently
  returned hundreds of millions of raw rows through billable Shared Pooler egress.
- `series_dirty` coupled score-cache freshness to R2 availability. Its `ON CONFLICT DO NOTHING`
  mark plus unconditional delete can erase a concurrent update.
- Rebuilding a complete history on every RSS change is still corpus-shaped work: active feeds can
  change the same recent videos every fifteen minutes. The materializer must transfer deltas, not
  repeatedly reconstruct histories.
- The existing R2 series object already carries an exact raw source representation suitable for a
  one-time cache bootstrap. The existing merged gzip row remains readable during expansion but is
  not incrementally mutable without losing delete/update correctness.

## Key Decisions

1. **Expand before switching.** Add an append-only `observation_change_log`, `obs_cache_dirty`,
   `score_dirty`, queue generations, and v2 cache columns without dropping legacy state.
2. **Database-owned capture.** Statement-level triggers on `view_snapshots`, `view_samples`, and
   `rss_samples` capture inserts/updates/deletes and mark all queues atomically, covering current
   and future writers without per-video client round trips.
3. **Raw v2 projection.** Cache format 2 stores the canonical raw observation subset, gzip
   compressed. Delta upsert/delete is exact; decoding runs the existing `mergeObservations` code,
   so score semantics have one implementation.
4. **Watermark clearing.** Every queue claim includes a generation. Completion clears only that
   generation; a mark arriving during work survives.
5. **Fail closed.** Batch `loadRecords` uses cache-only mode. Missing, legacy, or dirty rows defer
   affected score work and request bootstrap/materialization; they never invoke
   `OBSERVATION_RECORDS_SQL`.
6. **Age-aware score cadence.** The score queue selects launch-window work within minutes, ages
   1–7d hourly, 7–30d daily, 30–60d every three days, and older rows weekly. Model rollouts enqueue
   through a separate bounded command.
7. **Bootstrap budgets.** R2 is first choice. Raw Postgres bootstrap requires an explicit video
   and returned-row ceiling checked by a server-side count before any history leaves Supabase.

## Acceptance Contract

- A statement that writes 5,000 observations produces set-based queue work, not 5,000 client
  requests.
- Insert, update, and delete deltas produce the same merged observations as a fresh full rebuild.
- A concurrent mark after a claim is not cleared by completion for `series_dirty`,
  `obs_cache_dirty`, or `score_dirty`.
- The default scorer target query reads `score_dirty`, returns at most 100 rows per page, applies
  age cadence, and contains no raw-table `EXISTS` predicate.
- Batch scoring has a statically tested zero raw-miss budget; an incomplete cache defers work.
- Successful score/history/channel-headline writes clear only their claimed score generations in
  the same transaction.
- The materializer caps videos, change rows, and compressed bytes per run and logs those totals.
- Bootstrap refuses to query raw histories unless both explicit budgets are present and the
  server-side row count is within them.
- Old cache rows remain decodable during expansion; only format-2 rows are eligible for the batch
  scorer.
- Migration is idempotent, restricts internal tables from anon/authenticated access, adds indexes
  without a corpus rewrite beyond the small queue/cache tables, and has a rollback script that
  removes triggers before functions/tables.

## Work Units

- [x] **Queue and projection contracts (RED → GREEN).** Add outcome tests for v2 delta parity,
  fail-closed cache reads, statement-level trigger DDL, and watermark-safe queue SQL; implement the
  pure projection format and migration.
- [ ] **Bounded observation materializer (RED → GREEN).** Test claim/apply/complete behavior,
  partial batches, bootstrap deferral, and byte ceilings; implement the worker and dry-run surface.
- [ ] **Queue-driven scorer (RED → GREEN).** Test age-aware due selection, cache-only enforcement,
  defer/retry, and atomic generation clear; switch the default scorer path without changing
  explicit fit/final/force lanes.
- [ ] **Bootstrap and rollout lanes (RED → GREEN).** Test mandatory budgets and bounded SQL; add
  R2-first observation bootstrap and explicit model-version queueing.
- [ ] **Separate and repair R2 invalidation (RED → GREEN).** Add generation claims to
  `series_dirty`, remove observation-cache refresh from the R2 drainer, and prove concurrent marks
  survive.
- [ ] **Operational packaging and verification.** Add inactive LaunchAgent templates/runbook,
  run focused tests, local PostgreSQL integration when configured, type/lint/build gates, and a
  fixed-base data/architecture review.
- [ ] **Compound.** Keep executable guards that reject batch raw fallback and unbounded recurring
  work; update the canonical incident note and project/session memory after verification.

## Verification Handoff

- Focused Jest suites cover the pure projection, cache policy, queues, scorer target selection,
  materializer, bootstrap budgets, migration contract, and series drainer.
- A local-PostgreSQL integration test (when `RSS_TEST_DATABASE_URL` is local) applies the migration,
  writes/upserts/deletes raw observations, and observes the change/dirty rows.
- Run all active `lib/**/*.test.ts`, scoped TypeScript diagnostics, lint if the repository command
  is functional, and `npm run build` as the integration gate.
- Inspect `git diff 0cef7a6...HEAD`; verify no `.env`, logs, generated data, or unrelated code is
  present.

## Risks and Rollback

- Trigger overhead: statement-level set operations bound database round trips; verify with local
  multi-row insert and production `EXPLAIN` before activation. Rollback drops triggers/functions
  first, leaving raw observation tables untouched.
- Queue growth: change log is transient and deleted only after cache commit. Alert rather than
  delete an unmaterialized row; cleanup may delete only rows at or below a committed cache
  watermark.
- Legacy cache: format 1 is readable interactively but rejected by batch scoring after cutover.
  Roll back scorer selection before dropping new state.
- Partial rollout: deploy migration first, bootstrap format 2, verify parity/hit rate, then install
  materializer and switch scorer. Never switch the scorer first.

## Stop Conditions and Budgets

- Recurring materializer defaults: at most 100 videos, 5,000 delta rows, and 5 MB compressed cache
  output per run; each is a hard stop, not a warning.
- Scorer defaults: at most 1,000 targets per run, fetched in pages/batches of at most 100.
- Raw bootstrap runs only with explicit `--raw-video-budget` and `--raw-row-budget`; exceeding the
  count aborts before the raw query.
- Production activation stops if `EXPLAIN (ANALYZE, BUFFERS)` shows a sequential scan on a raw
  observation table, cache parity is not exact, any batch raw fallback occurs, or Video Scripter
  egress remains above its allocated daily budget.
