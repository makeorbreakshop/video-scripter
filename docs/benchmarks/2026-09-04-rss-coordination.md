# RSS scoring and API coordination verification

Candidate: `ingest/rss-coordination`, observation version `v5.1-rss`; scoring mathematics and fitted parameters remain `v5.0`. User expressly requested RSS observations participate in scoring, superseding the older rejected v3 RSS experiment. This is a bounded rollout, not a new projection calibration claim.

## Contract and verification

Active RSS cadence remains 15 minutes on a 5-minute worker tick, with dormant/error backoff. RSS is scoring evidence for targets and priors, survives neighboring API readings, and triggers dirty selection. Real timed evidence supersedes synthetic daily anchors; exact ties prefer API. Plateaus retain endpoints/newest clock and counter corrections remain valid. Current score/history writes are atomic, and their read watermark preserves concurrently arriving evidence for a later pass.

Routine API deadlines can use RSS within min(interval,20 minutes), newer than the last API, without a declining count; API bursts under 15 minutes remain intact and an API crosscheck is required every six hours. Hydration avoids an immediate redundant API read. Optimistic schedule updates preserve concurrent packaging re-entry. Unchanged RSS counts still use the existing 24-hour stored heartbeat, so a recently polled but unchanged count may legitimately require API; quota savings are not claimed to equal all RSS coverage.

Collector regressions fixed: unknown-video sample dedupe; true fetch-completion timestamps; unchanged-body heartbeat/title evidence; no advancement of an undiffed feed's accepted state; fail-closed pending replay; journal persisted before writes. Replay can extend a packaging burst after a crash because some schedule timestamps are replay-time; this favors extra work, not lost detection.

38 suites / 566 tests passed across ingestion scheduling, RSS, scoring, public API, curves, onboarding/backfill and privacy. After the final helper rename and watermark fix, 54 focused tests passed again. All three worker entrypoints bundle successfully. Repository-wide tsc remains red with 2,550 diagnostics; changed files have no diagnostics except the existing script top-level-await/target mismatch. This is not a clean whole-repository build claim.

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

Pending integration and bounded worker verification; append actual evidence before calling the rollout complete. No VPS deployment, full-corpus rescore, or parameter refit is part of this change.
