# RSS scoring and API coordination verification

Candidate: `ingest/rss-coordination`, observation version `v5.1-rss`; scoring mathematics and fitted parameters remain `v5.0`. User expressly requested RSS observations participate in scoring, superseding the older rejected v3 RSS experiment. This is a bounded rollout, not a new projection calibration claim.

## Contract and verification

Active RSS cadence remains 15 minutes on a 5-minute worker tick, with dormant/error backoff. RSS is scoring evidence for targets and priors, survives neighboring API readings, and triggers dirty selection. Real timed evidence supersedes synthetic daily anchors; exact ties prefer API. Plateaus retain endpoints/newest clock and counter corrections remain valid. Current score/history writes are atomic, and their read watermark preserves concurrently arriving evidence for a later pass.

Routine API deadlines can use RSS within min(interval,20 minutes), newer than the last API, without a declining count; API bursts under 15 minutes remain intact and an API crosscheck is required every six hours. Hydration avoids an immediate redundant API read. Optimistic schedule updates preserve concurrent packaging re-entry. Unchanged RSS counts still use the existing 24-hour stored heartbeat, so a recently polled but unchanged count may legitimately require API; quota savings are not claimed to equal all RSS coverage.

Collector regressions fixed: unknown-video sample dedupe; true fetch-completion timestamps; unchanged-body heartbeat/title evidence; no advancement of an undiffed feed's accepted state; fail-closed pending replay; journal persisted before writes. Replay can extend a packaging burst after a crash because some schedule timestamps are replay-time; this favors extra work, not lost detection.

40 suites / 572 tests passed across ingestion scheduling, RSS, scoring, public API, curves, onboarding/backfill and privacy. All three worker entrypoints bundle successfully. Repository-wide tsc remains red with 2,550 diagnostics; changed files have no diagnostics except the existing script top-level-await/target mismatch. This is not a clean whole-repository build claim.

Sol independently reviewed scheduler, collector, observations and scoring; no remaining integration blocker.

## Paired replay

`npx tsx scripts/evaluate-rss-coordination.ts --limit 20` runs read-only with a repeatable-read database snapshot, fixed database clock and unchanged v5.0 parameters. Hard cap 20 targets; sequential 100-ID reads. September 4, 2026, 3:50 PM ET: 20 compared targets, 312 distinct target/prior IDs.

| Metric | Median | p90 | Maximum |
|---|---:|---:|---:|
| Absolute score change (log-ratio converted to percent) | 0.91% | 2.48% | 9.80% |
| Absolute projection change | 3.20% | 9.03% | 14.34% |
| Latest observation age advanced | 21.57h | 27.46h | — |

Paid-reader query time 343ms; RSS-reader 377ms. Earlier warm/cache runs varied. This cohort demonstrates integration and bounds observed changes; it is not an accuracy benchmark or a representative population-level churn guarantee. The existing projection calibration limitations remain.

RSS latest-row EXPLAIN ANALYZE on 250 due IDs: historical DISTINCT scan 1,396ms; keyed lateral LIMIT1 with existing `(video_id,at)` index 2.234ms; both returned 143 rows. Query order/cache affects the exact ratio. Collector and scheduler share this keyed lookup. Scorer reads are bounded to 100 IDs to avoid large-array query-plan regressions.

## Capacity interpretation

Capacity follows distinct globally tracked channels, not account count or subscription edges. Observed corpus: 5,045 active + 1,367 dormant channels. Active feed demand is 96 requests/channel/day: 5k = 480k/day, 10k = 960k/day. The 6,000-channel/tick guard is not a proven sustainable capacity. Normal full-corpus ticks have completed in roughly 2–3 minutes, but competing database work has also exhausted the 285-second budget; 10k is a staged load-test target, not a promise.

Subscription synchronization overlaps global channels across users, but a cold 500-channel import can require around 500 initial video hydration requests plus identity/OAuth pages and deeper queued catalog work. At a 4,500-unit/day catalog budget and roughly 12 units per 300-video channel job, ideal throughput is about 375 cold channels/day: a 500-channel all-new account can exceed one day of catalog capacity alone. Repeated completed-job enqueueing and cold-import admission control remain scaling improvements from the broader audit. Existing two-owner-account traffic does not establish a user-count ceiling.

A VPS gives continuous execution and isolation from laptop use. It does not expand Google quota or the shared database's throughput. Keep global channel dedupe, bound/pace onboarding work, prioritize live discovery, and load-test RSS + database + onboarding together before increasing admission limits.

## Live rollout

Integrated into the live local main checkout on September 4, 2026. Implementation commits `df66be0` through `2e3ba84`; initial verification report `8f6819f` (implementation, evaluator isolation, sampler timestamp precision, cadence jitter and incremental scoring). Hosted app/API deployment awaits separate approval; no VPS migration or parameter refit was performed.

- 3:53 PM ET: pending RSS buffer replayed successfully (196 samples), then the canary wrote 20 more observations without error. Journal cleared.
- 3:58–3:59 PM ET: full RSS sweep of **5,013 channels completed in 99 seconds**: fetch 61.4s, snapshot 28.4s, diff 0.3s, flush 8.9s; 0 HTTP errors, 28,880 RSS samples, 94 newly queued videos, 19 title changes. Subsequent scheduled RSS tick completed successfully.
- 4:01 PM ET canary: **79 RSS deadlines advanced, 0 concurrency losses; 50 API samples using one request**. Database independently confirmed all 50 API schedule rows advanced.
- 4:07 PM ET scheduled sampler: **1,806 RSS deadlines advanced, 0 concurrency losses**; It then completed 1,250 API samples using 25 calls, with exit code 0. These are actual updates, not estimated savings. It continues to preserve bursts and crosschecks.
- Scorer canary: 13 scores and 13 matching history rows, 12 usable channel curves; 7 scores used RSS as the latest observed count. Parameters remained v5.0. Nine additional all-age eligible rows were scored; repeating the identical command found **zero work**, demonstrating incremental convergence.
- Nightly snapshot path canary: 47 snapshots from one API call (catalog pass disabled for this bounded check). The preexisting LaunchAgent last-exit failure was from the morning run; this canary is not a claim that the full next nightly run has already completed.
- RSS discovery→drainer check: 97 recent feed queue entries reached terminal processing, 54 had video rows plus API hydration samples, and all 97 retained RSS observations. The drainer currently labels terminal classifications `imported` even when its insert classifier skips a row; terminal count must not be reported as successful video imports.
- Local public API compiled and returned the expected 401 without credentials; authenticated curve behavior is covered by the route test. A fresh human OAuth signup was not exercised.

### Problems found during live verification and resolved

The evaluation harness initially used a session-level read-only setting. The shared transaction pool retained it, causing temporary writer failures. The harness now uses only an explicit read-only transaction and SET LOCAL timeout; a regression guard forbids persistent settings. Four observed contaminated writer backends were restored to their expected default; a subsequent check held eight connections and confirmed all defaults were read-write. RSS's pending journal preserved the failed work and replay succeeded. No role or database defaults were changed.

Optimistic sampler updates initially compared JavaScript millisecond Date values to PostgreSQL microsecond timestamps, leaving already sampled rows due. Exact text timestamp tokens now preserve all precision; live row-count and independent database checks confirm advancement. A source regression guards the text casts and update predicates.

A scheduled RSS tick at 3:56:08 PM was 12 seconds short of the previous tick's 15-minute cutoff, which deferred ~5k channels to a fourth tick. A tested 60-second early-eligibility tolerance now applies only to normal active/woken polling, preserving dormant and error/backoff intervals.

An already-running, independently started whole-corpus rescore loop assumed `--all --limit 20000` was incremental, but the old selector repeatedly chose the newest 20k rows. `--all` now removes the age ceiling while retaining dirty/version-mismatch selection; `--all --force` explicitly requests an unconditional rewrite, and `--since` retains its force semantics. The old in-flight pass was stopped; the existing loop resumed with the repaired selector. No new corpus rescore was started. Its large backlog is still running; later full-corpus selections can take longer (observed ~109s), so completion and future scale are not claimed here. There is no scheduled `--final` worker; if added later, avoid competing final/live version ownership.

### Remaining scope

Cold onboarding quota/admission control, missing snapshot-queue consumer, owner inventory/lease recovery, legacy route authentication, full long-tail/chart calibration and VPS migration remain items in the broader audit. This change implements and verifies RSS/scoring/API coordination, not every unrelated audit finding. Current observed scale is about 5k active channels; 10k still requires a combined workload test.
