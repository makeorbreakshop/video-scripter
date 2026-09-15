---
title: Restore prompt scoring and honest baseline display
status: active
artifact_readiness: implementation-ready
execution: code
---

## Outcome

Fresh, high-reach never-scored long-form uploads receive bounded priority over routine refresh work; a cache miss blocks only the score targets that depend on that missing observation state; and an unscored video page still shows any independently computable channel-typical curve while describing the delayed score honestly.

## Non-goals and protected behavior

- Do not change v5.4 score, baseline, growth, confidence, or forecast math.
- Do not read raw observation histories from the scheduled scorer.
- Do not weaken the 100-target database work-unit cap, age-aware refresh cadence, generation-safe queue clearing, or scorer lock.
- Do not push, deploy, edit the installed LaunchAgents, drain the live queue, or write production score rows without separate authorization.
- Preserve legacy pre-v5 chart behavior and livestream suppression.

## Prior Learnings

- Fresh committed work must not wait behind discovery/backfill work; the tracked-upload priority-lane incident is the directly analogous failure.
- `score(t) = views(t) / C(t)`. The channel-typical line is independently computable from the canonical prior loader and must not be confused with the stored score row or the video's own forecast.
- Scheduled scoring has a zero raw-miss budget. Missing caches must be materialized asynchronously, but healthy work must continue.
- Current production evidence for Ryan Trahan video `1w3XaMSIeR8`: 198 observations, 15 usable current cached priors, no score row, due since September 12, and 4,530 due rows ahead. A read-only v5.4 replay gives about 4.92x against C(3.02d) about 1.36M.

## Key Decisions

- Select two bounded lanes in one query: reserve part of every run for high-reach never-scored videos published in the last week, then fill all remaining capacity with the existing age-aware queue order. This prevents breakout starvation without starving smaller or older work.
- Expose cache availability as a result instead of making the loader discard healthy cached records when any requested ID is missing. Partition targets by their complete dependency set; score ready targets and defer only blocked targets.
- Treat `score === null` as an unprocessed current-model state, not as a legacy score. Use the already-computed canonical typical curve and replace the scheduling promise with a truthful delayed-state label.

## Acceptance Contract

- A bounded 100-row queue fetch includes fresh high-reach due never-scored videos even with an older refresh backlog, while retaining capacity for the ordinary FIFO lane.
- Queue selection remains deterministic, generation-safe, raw-history-free, and capped at 100.
- Given two score targets where only one depends on a missing prior cache, the ready target is scored in that run; only the dependent target is deferred and the missing cache ID is enqueued.
- Existing current format-2 target/prior caches produce exactly the same v5.4 outputs as before.
- An unscored non-broadcast video with a computable typical curve returns that curve to the chart.
- The unscored header says the score is delayed/awaiting processing and never claims the next run will process it.
- Legacy pre-v5 rows and broadcast pages retain their established curve behavior.

## Work Units

- [x] RED: add outcome tests for never-scored queue priority and reserved refresh capacity; confirm failure.
- [x] GREEN: implement the bounded two-lane target query; confirm focused tests and inspect its live plan with a bounded `EXPLAIN (ANALYZE, BUFFERS)`.
- [x] RED: add outcome tests proving a missing cache blocks only dependent targets; confirm failure.
- [x] GREEN: preserve partial cache results, partition target dependencies, and score ready targets; confirm focused and integration tests.
- [ ] RED: add video-page tests for an available baseline without a score row and truthful delayed copy; confirm failure.
- [ ] GREEN: render the canonical typical curve for the unprocessed state and correct the copy; confirm focused tests.
- [ ] Refine the changed seams without changing behavior; run focused suites, broader scoring/app suites, type/build gates, design lint, and a local rendered desktop/mobile check.
- [ ] Perform the independent standards/spec review, record any operational rollout steps separately, and leave production untouched.

## Verification Handoff

- Focused: `materialization-queue.test.ts`, new cache-isolation tests, `video-page.test.ts`, `feed-live-score.test.ts`, `typical-curve` tests.
- Integration: existing event-materialization database test when its isolated database is available; otherwise record the missing environment and run a read-only live SQL plan plus pure dependency outcome test.
- Regression: scoring/observation suites, app chart/verdict suites, TypeScript/build.
- UI: run the `brandon-ai-defaults-v1` source lint over the fixed diff, then render the Ryan-like unscored state at wide and narrow viewports and verify baseline visibility/state truth.
- Operations: compare query plan, returned rows, and queue classification only. Any live queue mutation, manual score, scheduler change, push, or deploy remains a separate approval boundary.

## Risks and Rollback

- Priority can starve refresh work; reserve refresh capacity in every fetch and test it.
- Partial cache loading can accidentally score against an incomplete prior set; a target is ready only when its own cache and every canonical prior cache are present.
- Query sorting can regress database load; the recurring-query EXPLAIN gate is mandatory before rollout.
- UI fallback can accidentally route legacy rows through v5; distinguish a missing row from an existing non-v5 row explicitly.
- Rollback is the feature-branch commit(s); no schema or production state changes are required for the proposed repair.

## Stop Conditions and Budgets

- At most two review-fix loops.
- Stop before any production mutation or external rollout.
- Stop and re-plan if the priority query requires an unbounded scan or a new schema/index migration.
- Keep all database reads bounded to target IDs, server-side aggregates, or one `EXPLAIN` of the exact 100-row query.
