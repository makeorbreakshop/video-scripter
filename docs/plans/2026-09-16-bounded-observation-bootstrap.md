---
title: Drain legacy observation caches without starving live scores
status: active
artifact_readiness: implementation-ready
execution: code
---

## Outcome

Replace the 100-video FIFO bootstrap trickle with one bounded 500-video batch every five minutes. Reserve a small lane for dependencies the scorer has just requested, while the rest continues draining the oldest legacy cache work.

## Non-goals and protected behavior

- Do not change v5.4 scoring math, prior selection, cache exactness, or zero-raw-miss scoring.
- Do not add connections or parallel Supabase history readers; the bootstrap keeps one transaction client.
- Do not exceed 500 videos, 20,000 raw rows, 5,000 deltas, 5 MB compressed output, or the existing 60-second statement timeout per run.
- Do not launch the larger production batch until current org usage, real query plans, and a bounded dry-run canary are acceptable.

## Prior Learnings

- A pooler controls connection pressure, not query CPU, disk IO, or egress.
- The current backlog is 20,653 legacy bootstraps. The worker drains 100 every five minutes while a score may require the target plus 15 priors.
- In the first repaired scorer cycle, 61 targets exposed 506 legacy dependencies; FIFO bootstrap ordering made current scoring wait behind migration work.
- Recent 100-video bootstrap receipts returned 24–153 KB and completed in 6–15 seconds, but scaling must remain row- and time-bounded.

## Key Decisions

- Keep one transaction-mode Supavisor client.
- Increase only the video claim ceiling and scheduled video budget to 500; retain the existing 20,000-row raw egress ceiling.
- Reserve 20% of each claim for dependencies marked in the last ten minutes, ordered newest first; use the remaining 80% for FIFO backlog drain.
- If a 500-video claim exceeds the existing row/compressed/delta/time budgets, fail closed rather than widening another budget.

## Acceptance Contract

- A focused test fails before implementation because the claim has no priority lane and the hard ceiling is 100.
- After implementation, a 500-video claim can contain at most 100 recent dependencies and at least 400 FIFO rows when available.
- The scheduled definition uses 500 video/raw-video budgets but keeps the 20,000 raw-row budget and five-minute cadence.
- The script pool has one connection and retains its 60-second statement timeout.
- Real `EXPLAIN (ANALYZE, BUFFERS)` uses indexed queue/video lookups without a sequential scan on a table over 1 GB.
- A dry-run canary returns no more than 20,000 raw rows, completes within the job window, and reports bounded response bytes before production activation.

## Work Units

- [x] Add RED contract tests for two-lane claims, the 500-video ceiling, one connection, and unchanged raw-row/cadence limits.
- [x] Implement the bounded two-lane claim and scheduler capacity; make focused tests GREEN.
- [x] Run focused and broader observation/scoring regression gates.
- [x] Check current org usage, inspect live plans, and run one dry-run 500-video canary.
- [ ] If gates pass, install the scheduler definition, observe one live cycle, and verify scorer deferrals and queue health.
- [x] Review the fixed diff and record rollback evidence.

## Verification Handoff

- Tests: observation bootstrap, background job contract, operation guard, event materialization, and scorer cache policy suites.
- Runtime: compare bootstrap queue counts and scorer scored/deferred counts before and after one scheduled cycle.
- Egress: use trace `estimated_response_bytes`; stop if the canary exceeds 2 MB or approaches any hard budget.

## Risks and Rollback

- Risk: a channel with unusually dense observations makes a 500-video claim exceed 20,000 rows. Behavior must fail closed with no commit.
- Risk: priority work starves the migration. The priority lane is capped at 20%; FIFO always keeps 80% when available.
- Rollback: restore the prior launchd definition (`100/100/20,000`) and reload it. No schema or score-math rollback is required.

## Stop Conditions and Budgets

- Stop on org egress above 70%, any large-table sequential scan, canary response above 2 MB, statement timeout, serialization failure, or production error.
- One implementation/review retry at the same boundary before re-planning.

## Gate Evidence

- Org egress was 46.586 GB of 250 GB (19%) for the current billing cycle.
- The optimized live claim plan completed in 21.96 ms with 3,716 shared-buffer hits and no sequential scan on a table over 1 GB.
- The 500-video dry run read 6,028 raw rows, produced 226 deltas, estimated 568,931 response bytes, completed in 14.305 seconds, and rolled back successfully.
- Focused and broader regression gates passed: 7 suites and 45 tests. The production Next.js build also passed.
- Repository-wide `tsc --noEmit` remains blocked by pre-existing unrelated type errors across generated route types, legacy handlers, tests, and workers.
