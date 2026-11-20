---
title: Move the readings pipeline off Supabase onto a local Postgres on the Mac Studio
status: active
artifact_readiness: implementation-ready
execution: code
---

# Local pipeline database

## Outcome

Supabase becomes a **serving store**. It holds what the website shows: videos, scores,
channel stats, packaging versions, params. Every raw reading, every queue and the whole trigger
chain live in a local Postgres 17 on the Mac Studio (64 GB RAM, 378 GB free), where reads are
free and the working set fits in memory. The Mac computes; Supabase receives results.

Brandon, 2026-11-20: "just do the full best in class solution … channel smith isnt mission
critical … we can even do dumb storage on the nas … really want to cut way down on the supabase
reads." Being down while the Mac is down is acceptable.

## Why (measured 2026-11-20, pg_stat_statements since 2026-11-12)

- Supabase Small: 29 GB database, 512 MB shared_buffers, 85.6 % cache hit. Every active
  statement waits on `IO:DataFileRead`, and that is the cause of the whole 57014 family.
- rss_samples is 14 GB (pkey 4.9 GB, delete-thinned and bloated) of the 29 GB.
  observation_change_log is a 2 GB churn queue (10.7 M inserts, 9.7 M deletes).
- Each RSS reading fans out to about 7 table writes through statement triggers: 26 % of all dirtied pages.
  1,000-reading chunks exceed the 30 s timeout and roll back, and 15–49 pending buffers a day are
  quarantined, unwritten, by rss-poll.
- Already fixed today, about 30 % of reads: indexes for the view_samples day count, the touch_queue
  pending scans and the launch-track changed scan, plus PR #17.
- The pipeline statements that move with this plan are about 55 % of the remaining reads: the rss insert,
  queue-ensure, bootstrap, snapshot-triage, the rss day count, the materializer claim, the
  view_snapshots and view_samples inserts, the obs-cache upsert, delta reads and launch-track.

## Non-goals and protected behavior

- Website pages and `/api/v1` keep working, with the same chart shapes (series-equality test).
- No reading is lost. The R2 archive (`channelsmith-readings`) stays the permanent raw record.
- No new paid services. No Supabase plan change.
- Not a rewrite of scoring math, chart rendering or RSS policy.

## Prior Learnings

- Supabase egress is org-wide and metered for pooler SQL too. Bulk loads come from R2 parquet and
  the local export mirrors, not Supabase. Only the unarchived dense tail, the last ~4 days, is
  read from Supabase, once, bounded and narrow (skills/supabase-operations).
- PL/pgSQL row loops are slow. The ported triggers are already statement-level and set-based.
- CREATE INDEX CONCURRENTLY on Supabase needs `lock_timeout` ≥ 10 min (2026-11-20).
- Never stop processes by name. LaunchAgents use `/opt/homebrew/bin/node`.
- Production jobs run from the canonical checkout, which carries uncommitted operational edits
  (rss-poll pending replay). Edits there are exact replacements, and nothing is reverted.

## Key Decisions

1. **Local Postgres 17 (Homebrew), not SQLite, DuckDB or NAS files.** The pipeline is SQL with
   triggers. Same dialect means the trigger chain ports verbatim and job queries keep working
   when only their connection string changes. The NAS is for nightly `pg_dump` backups. R2 stays the
   permanent archive.
2. **Connection split by table, not by job.** `lib/db/pipeline.ts` exports
   `pipelinePool()` (local, `PIPELINE_DATABASE_URL`) and the existing pool stays Supabase. Each
   statement goes to the database that owns its table. A guard test fails if a moved table's name
   appears in SQL sent through the Supabase pool.
3. **Ownership after the cut.**
   - Local, the system of record: rss_samples, rss_latest, rss_response_state, view_samples,
     view_snapshots, observation_change_log, video_obs_cache, obs_cache_dirty, score_dirty,
     series_dirty, mirror_dirty, video_score_history, track_schedule, view_tracking_priority,
     description_versions, video_title_watch, video_day30_truth.
   - Local read replicas, refreshed from Supabase incrementally: `videos` (needed by
     triggers and joins; the export mirror already syncs it), `video_scores`.
   - Supabase, serving: videos, video_scores, channel_stats, thumbnail_versions,
     title_versions, score_params, and everything else the app reads.
   - Supabase inboxes, which the Mac drains: touch_queue (WebSub), and new
     `reading_inbox` and `bootstrap_requests` for the two website write paths (trackChannel's
     first sample, chart-miss requests).
4. **The website never reads raw readings.** Charts come from the R2 series files, which already
   exist and are rebuilt by rebuild-series, now reading locally. The chart's "current" overlay reads a small
   published `video_chart_current` row instead of `video_obs_cache`. `/api/v1/videos/[id]` serves the
   series file. Header counts come from a published `reading_count` column.
5. **Expand → migrate → contract.** Both databases stay valid between stages. Supabase raw
   tables are dropped only after a 48 h shadow period with parity checks, and only after the R2
   archive verifies.

## Acceptance Contract

- A1. The local pipeline DB holds every reading: for each archived day and source, the local
  count equals the R2 index's row count (raw, unthinned); for each unarchived day it equals
  Supabase's count. (`npx tsx scripts/pipeline-load.ts parity`)
- A2. Every job in `lib/ops/scheduler-jobs.ts` runs with zero statements touching a moved table
  on Supabase (guard test plus the `pg_stat_statements` delta after 24 h).
- A3. The website's video page, channel page and `/api/v1/videos/[id]` render the same series as
  before for a sample of 50 videos (series-equality harness).
- A4. After the contract stage, the Supabase database is under 12 GB and its cache hit is at least 99 % over 24 h.
- A5. No 57014 or 40P01 in scheduler job logs for 24 h, and rss-poll quarantines nothing.
- A6. Nightly `pg_dump` of the local DB lands on the NAS and a restore test passes.

## Work Units

- [x] **U1 Stand up the local DB.** Postgres 17 via Homebrew; a tuned config (shared_buffers 16 GB,
  effective_cache_size 40 GB); a `channelsmith_pipeline` database; a schema for the moved tables
  plus replica `videos`/`video_scores`, extracted from Supabase with pg_dump 17 `--schema-only`;
  triggers and functions ported. Check: an empty-schema smoke test that inserts one rss row
  and sees it fan out to obs_cache_dirty, score_dirty and series_dirty.
- [x] **U2 Bulk load without Supabase egress.** Readings come from R2 parquet days; view_snapshots and
  videos from the export mirrors; the last ~4 unarchived days from Supabase, narrow and bounded.
  Check A1 per day and source.
- [x] **U3 Pool split and guard.** `lib/db/pipeline.ts`, plus the guard test (red first: list the
  current violations).
- [ ] **U4 RSS slice end to end.** rss-poll writes readings, state and triage locally, and only
  title/thumbnail/description versions and `videos.title` to Supabase. Real path: one tick
  against both DBs, with the quarantine count 0 and the triage statements absent from Supabase stats.
- [ ] **U5 API sampling slice.** launch-track, track-due and sample-batch write view_samples and
  view_snapshots locally; track_schedule and view_tracking_priority move.
- [ ] **U6 Observation and scoring slice.** The materializer, bootstrap and score-videos read locally
  and publish `video_scores`, `channel_stats` and `video_chart_current` to Supabase.
- [ ] **U7 Website contract.** Series file for v1 and the fallback; `video_chart_current`;
  `reading_count`; inboxes for the trackChannel and chart-miss writes. Check A3.
- [ ] **U8 Shadow, then contract.** 48 h of parity checks; then drop the Supabase triggers, then the tables
  (needs Brandon's yes at this exact step); `VACUUM`/repack. Check A4 and A5.
- [ ] **U9 Backups.** Nightly pg_dump to the NAS with a retention policy and a restore test (A6).

Dependencies: U1 → U2 → U3 → (U4, U5) → U6 → U7 → U8. U9 runs after U2.

## Decisions made while building (2026-11-20)

- **Local keeps raw readings.** The archive load restores every R2 reading, not Supabase's
  thinned subset: local is the system of record, disk is ample (~45 GB at load), and R2's raw
  day is what A1 checks against. Older-than-4-day readings are therefore denser locally than on
  Supabase. Before U6 points the materializer, bootstrap or series rebuild at local, either
  run `scripts/thin-readings.ts` against the local DB (it only needs `DATABASE_URL` and a copied
  `readings_archive_days` ledger with the thinned columns cleared) or confirm those readers'
  byte budgets hold on dense history.
- **Replica `videos` carries the export mirror's projection only.** `videos.user_id` is made
  nullable locally (sql/pipeline/001). If a moved job needs a column the projection lacks
  (e.g. `updated_at`, `title_observed_at`), widen the mirror spec instead of reading Supabase.
- **API readings archived before the tail lose `comment_count`.** R2 never stored it; Supabase's
  surviving rows have it. No pipeline reader of view_samples uses it (U5 to confirm).
- **The guard is a ratchet over source text** (`lib/db/pipeline-guard.test.ts`). 110 files are on
  the backlog, each tagged with the unit that moves it: U4 10, U5 13, U6 30, U7 16, legacy one-offs
  41 (moved or retired at U8). A file is exempt once it imports `lib/db/pipeline`; that is coarse
  (such a file could still send moved-table SQL through the Supabase pool), so the runtime
  `pg_stat_statements` delta stays part of A2. SQL built in a helper is caught in the helper's
  module (e.g. `lib/readings/sql.ts`), not at its call site.

## Verification Handoff

- Guard: `npx jest lib/db/pipeline-guard.test.ts`
- Parity: `npx tsx scripts/pipeline-parity.ts --days 7` (per day and source counts, local vs Supabase)
- Website: `npx jest lib/readings/series-equality.integration.test.ts` plus 50-video render diff.
- Supabase load: `pg_stat_statements` reset, then the top readers after 24 h.

## Risks and Rollback

- **The Mac being down stops tracking.** Accepted (not mission critical). The local DB starts at login,
  and the scheduler already alerts on staleness.
- **Split-brain during dual-write.** Until U8, Supabase tables keep receiving writes, so rollback =
  point the pools back (one env var) with no data repair.
- **Disk.** The DB is ~25 GB at load and grows ~5 GB a month before thinning; 378 GB is free. The
  disk guard covers it.
- **Contract is irreversible.** It runs only after the 48 h parity check and Brandon's explicit yes.

## Stop Conditions and Budgets

- Stop for Brandon's review after U3 (first checkpoint) and again before U8's drops.
- Each unit ≤ 2 retries on the same failure boundary, then re-scope.
