---
title: Reject stale RSS view responses and measure residual decreases
status: revision-required
artifact_readiness: requirements-only
execution: code
---

## Current decision — do not deploy the discard-only implementation
Brandon requested preservation of responses and historical placement of late cached readings, then asked to test that approach first. The old implementation below is superseded as a rollout candidate. No production changes were made. A standalone experiment in scripts/experiments/rss-response-history.ts now tests response-time reconstruction, audit receipt preservation, observation deduplication, and conflicts. It is not imported by production code.

13 new experiment tests pass (6 failures observed against fetch-time baseline before changing the experiment). Four scoped suites / 58 tests pass; targeted TypeScript passes. All 24 captured per-video receipts preserved, 21 historical observations after exact video/time/count deduplication. Both pilot arrival-order drops disappear through actual chart math, including API combinations. Earlier stored database rows corroborate the cached count/time within one second for Every and PTFO. Unknown timestamps and newer count corrections remain; same-time conflicts are explicit. HTTP Date/Age are not exact view measurement timestamps. Full raw-XML archiving, retention/storage design, production metadata propagation/labels, and revised persistence remain unimplemented. Historical September 6 drops cannot be retroactively diagnosed from missing headers.

## Outcome
Preserve response freshness; reject RSS count updates from an older known HTTP Date; measure decreases before and after that filter, with all comparable fetched readings as denominator. No automatic API checks.

## Non-goals and protected behavior
No historical rewrites, monotonic clamping, score formula changes, title/discovery behavior changes, or production deployment. Missing/invalid Date remains unknown. HTTP Date is response time, not count measurement time. Age alone does not establish an exact source timestamp.

## Prior Learnings
Live Every/PTFO checks showed fresh → cached older responses; cache Age ~7.5 minutes and Date regressed. Stored-reading decrease rates omit unchanged fetches and cannot establish cache incidence.

## Key Decisions
One bounded row per channel in rss_response_state: high-water HTTP Date, latest response metadata, latest rejected response counts, accepted latest-feed counts, cumulative counters since first measurement. No append-only audit table or recurring cleanup: ~6.5K rows × roughly 5KB ≈33MB logical upper estimate, to verify locally. Raw last rejected response retained until another rejection replaces it. Counter and accepted sample writes transactional; replay idempotent by fetch timestamp. Existing pending buffers without metadata retain legacy behavior. Unknown response dates never reset known watermark.

## Acceptance Contract
Older responses cannot add chart/scorer observations, including increases. Newer decreases are preserved and counted. Missing Age with valid Date is usable; missing/invalid/future Date is unknown. Duplicate/replayed events cannot inflate counters. Failure rolls back state and sample writes. Every valid comparable fetched count contributes to denominator including unchanged counts. Reports include coverage and measurement start/end, never claim all historical dips are solved.

## Work Units
1. Pure response assessment, RED/GREEN tests using captured sequence.
2. Small private state-table migration and transactional persistence; real local Postgres tests including replay/rollback.
3. Wire existing poller, preserving title/discovery behavior and pending replay; read-only metrics report.
4. Regression checks, local query plans, diff review and handoff. Existing running worker stays unchanged until deployment is authorized.

## Verification Handoff
Jest RSS + related scoring tests; real disposable local Postgres; script compilation; inspect SQL EXPLAIN on local representative tables. Read-only production indexed plan check for existing last-sample query if changed (not planned).

## Risks and Rollback
Requires state migration before worker deployment. Keep raw legacy records; future-date header rejection is conservative. No new poll frequency or API quota. Roll back worker to prior revision; leave private state table in place. Local transactions bounded and one connection.

## Stop Conditions and Budgets
No production writes/deploy. Up to two fix retries before revisiting failure. No agents per repository instruction.

TDD Progress:
- [x] Step 1: Write failing test (RED)
- [x] Step 2: Run test - CONFIRM it fails
- [x] Step 3: Write minimal fix (GREEN)
- [x] Step 4: Run test - CONFIRM it passes
- [x] Step 5: Refactor if needed
- [x] Step 6: Run test - CONFIRM still passes

## Verification results
- Confirmed RED before fixes: 2 response-assessment failures, 4 transition failures, 3 local DB persistence failures, and the missing poller-wiring guard. Additional attribution test failed before its counters were added.
- GREEN: scoped RSS/chart/scorer regression suites pass; final command and totals recorded in session handoff. Real local PostgreSQL covers stale rejection, fresh correction, unchanged responses, replay, concurrent duplicates, per-channel separation, rollback, and legacy pending buffers.
- Targeted TypeScript compilation passes for poller, report, freshness and persistence modules.
- Actual captured first three experiment rounds replayed through database writer: 18 responses; 4 older responses rejected (one had unchanged counts), 2 raw decreases / 12 raw comparisons; 0 accepted decreases / 8 accepted comparisons. This is replay of the small selected experiment, not production incidence.
- Local batch: 2,140 feeds × 15 readings, 32,100 inserts in 259 ms. State table 3,712 kB / 2,146 rows, average state 1,358 bytes. Primary-key lookup EXPLAIN ANALYZE uses Index Scan, 0.026 ms for two channels. These local timings are not production performance guarantees.
- No historical records rewritten, no automatic API checks, no production schema changes or live worker deployment.

## Rollout and measurement
1. Apply migration `20260907120000_rss_response_state.sql` before switching the worker to this revision. Worker direct database role must own the private table or receive explicit permissions.
2. Deploy the worker changes together with lib/rss/response-freshness.ts and response-store.ts. Old pending buffers remain replayable. The first response per channel establishes a baseline; it cannot be classified against headers we never collected.
3. Existing polling cadence gathers counters automatically; do not create another scheduler. Run `npx tsx scripts/rss-freshness-report.ts` to read cumulative coverage, freshness gaps, and raw/residual decrease rates. Save reports at the start and end of a representative interval to assess changing coverage. This command makes no API calls and reads only the small state table.
4. Do not extrapolate the six-video pilot to the corpus. Unknown freshness and newer decreases remain accepted; residual decreases are candidates for investigation, not automatically API-verified or automatically errors.
5. Rollback: revert worker changes; leave private telemetry table for evidence. Do not replay rejected counts into history.

## Review and compounding
Reviewed current diff sequentially per repository instruction: new state bounded per channel, no source-time claims beyond HTTP Date, no response metadata on legacy rows, atomic state/sample persistence and replay guard, existing title/discovery behavior preserved. Existing source guard plus behavioral and real-database regressions encode the recurrence; no separate learning framework needed. UI gates/build skipped because this change touches only backend worker/data logic.

## Launch freshness and model-impact follow-up
- Active launch policy uses API for 5-minute bursts: standard first hour, dense first two hours; later 15/30-minute deadlines may use RSS. Existing API fallbacks include rss_declined, stale_rss, rss_not_newer and six-hour crosschecks. These predate this branch; prior references to “no automatic API” mean no NEW fallback, not absence of existing behavior.
- Production sampling-freshness receives rss_samples.at (fetch time). Revised response-time history must also inform scheduler source selection; otherwise stale cached responses can suppress a needed routine API check. Do not ship chart-only correction as complete freshness handling.
- Captured mismatches had Age 449,455,474 seconds (7m29–7m54). Maximum header age in the 24 comparisons was 615 seconds (10m15), and that count matched API. Response age is not a measurement of internal YouTube count lag. A 7.5-minute-old response can approach 22.5 minutes old before the next 15-minute poll; this arithmetic is not a measured service ceiling.
- Read-only spot check of six newest non-Short uploads found first API observations 3.5–8.63 minutes after publication; not a fleet-wide coverage guarantee.
- Four fixed-input characterization tests (27 scoped tests total with launch/source suites) establish: interior target RSS leaves newest API anchor, Q, same-age score, forecast unchanged with frozen priors; extending earliest target history can change Q and projection; five-minute bursts select API; response-time vs fetch-time changes routine source choice. Synthetic fit exercises nonzero Q bins; not an accuracy benchmark. Historical data added to channel priors can independently move the baseline. Revised model eligibility needs testing separately from chart placement.
