---
title: Coordinate RSS observations, scoring, and API sampling
status: active
artifact_readiness: implementation-ready
execution: code
---

## Outcome
RSS is first-class scoring evidence; API stats fill gaps rather than blindly duplicate fresh routine RSS readings. Preserve rapid launch/change bursts and periodic API calibration. Verify real bounded production worker runs after integration. Capacity answer distinguishes user follows from globally distinct active channels and is in the audit.

## Non-goals and protected behavior
No VPS purchase/migration, billing implementation, scoring formula redesign, or corpus-wide rescore. Preserve public/private ownership boundaries, existing 5/15/30 launch ladders, dormant backoff, prior model history and current approved growth parameters. Do not change unrelated main work. User authorizes implementation, tests and running-system verification; no broad unrelated audit remediation.

## Prior Learnings
Production runs from main checkout: candidate isolated at ../vs-rss-coordination (base f6be13c). RSS shadowing12h and exclusion from scorer contradict user requirements. Prior experiments had churn/SQL regressions, so shared pure source merge, bounded indexed reads and paired frozen-cohort tests are required. Scoring is now v5 despite older skill's v3 examples. Shared-pooler egress is billed. Main may continue moving.

## Key Decisions
Keep raw RSS/API source timestamps and legitimate counter corrections; prefer API at exact timestamp conflicts; exclude a synthetic daily snapshot when real timed evidence covers that day. No 12h RSS erasure. Preserve latest repeated-count time for current age while avoid weighting repeated points as independent events in merges. Read RSS in scoring targets and priors; version observation contract separately via v5.1-rss label, reuse approved v5.0 params explicitly until an intentional fit. Add RSS dirty selection. Keep hourly scoring cadence unless measurements justify changing it.
Routine API interval>=15m may be fulfilled by fresh RSS, except required API calibration; keep faster bursts, reject invalid/future/regressing RSS. First hydration sample defers immediate re-read. Use existing per-video indexes; no broad new table/migration unless measured need proves it.
Fix collector prerequisites: true fetch timestamp for observations, unchanged-feed heartbeat/evidence, unknown-id dedupe, aborted-snapshot hash guard, and fail-closed pending replay. These prevent invalid evidence/freshness from gating API work.

## Acceptance Contract
- A video with only eligible RSS data can score; a later RSS reading makes it dirty and changes current score at its real observation age.
- RSS and API coexist, tie/duplicate policy deterministic; no future readings, negative/nonfinite counts or synthetic daily duplicate overweight.
- API/page curve uses shared merge; newest observations retained in capped API output.
- Fresh routine RSS avoids API; stale/missing/declining/future RSS does not; launch/change bursts and calibration still call API; new import avoids immediate duplicate.
- Collector cannot mark incomplete diffs accepted and unknown-ID observations dedupe.
- Scoped tests, all relevant suites, paired data replay, bounded SQL EXPLAIN, dry plans, Sol review, then real worker evidence and regression checks.

## Work Units
- [ ] Root: failing shared-observation tests, merge + scorer dirty/read integration/version metadata + API curve parity.
- [ ] Sol: failing freshness tests, launch scheduler planning/dry mode/integration.
- [ ] Root: collector timestamp/dedupe/abort/replay regression coverage.
- [ ] Root/Sol: paired frozen data replay, query plans and regression suite; inspect introduced errors separately from baseline failures.
- [ ] Integrate verified commits with main without overwriting unrelated work; bounded runtime runs and continued-worker health evidence.

## Verification Handoff
19-suites/237-tests prior audit baseline. New behavioral tests must fail before implementation. Read-only production data to frozen local fixture; same params/cohort for before/after; no paid data collection for evaluator. Run benchmark current champion when feasible, never rewrite BASELINE for a different sample/model. Old projection calibration already fails; do not claim it fixed. Sol independently reviews integrated code and recorded runtime evidence.

## Risks and Rollback
Version source changes, preserve v5.0 params; rollback isolated commit disables RSS substitution and restores old reader. Avoid shrinking API before RSS source flow proven. Stop on query regression, auth leakage, unbounded database load, unexplained cohort churn, or ownership conflicts. Runtime cap/pool budget remain bounded. No corpus bulk write. Candidate prepared outside live checkout.

## Stop Conditions and Budgets
At most two fix attempts per repeated gate before diagnosis. One Sol worker plus root. Bounded cohorts and statement timeouts; live verification scoped by limit. Escalate only genuinely missing user decisions after preparing concrete reviewable result.
