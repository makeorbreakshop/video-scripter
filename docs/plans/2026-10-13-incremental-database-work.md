---
title: Reduce repeated ChannelSmith database transfers
status: active
artifact_readiness: implementation-ready
execution: code
---
## Outcome
Reduce absolute recurring database reads: changed-key exports and fit inputs, ready-score work, verified cached reuse, and semantic text invalidation only when relevant content changes. Deploy after regression/integration gates with existing authorization.
## Non-goals and protected behavior
No R2 cutover, deleted raw data, lowered coverage/cadence, changed score math, wholesale new local source of truth, or changes to CFB. Keep full export artifacts and corrections/deletions. Supabase stays authoritative. Existing unrelated canonical changes stay intact.
## Prior Learnings
Whole-key scans cost183MB even with1.7MB changed contents. Late sequence commits invalidate naive high-water cursors. Local corruption must cause repair. Readiness may change between probe and read. One observed materializer wake deadlock rolled back; must not strand work. Generic videos.updated_at drives false text hydration.
## Key Decisions
Use durable per-key dirty work with exact-generation acknowledgment, local mirror commit before acknowledgment, single registered consumer, finite per-run bounds and bounded explicit bootstrap. Do not use max(sequence) as consumed cursor. Semantic content clock is lazily initialized from prior updated_at, never backfills the corpus. Gate scoring on current dependencies in a bounded preparation stage, retaining authoritative read validation.
## Acceptance Contract
Identical export rows, fit pairs and scores for fixed input; empty warm synchronization does not enumerate corpus keys; edits/deletes/key changes/late commits/crash replay/corruption work; view-only changes do not advance semantic content clock; real content changes do. Ready preparation leaves blocked requests durable without transferring their prior graphs. No unbounded automatic repair.
## Work Units
- [x] Changed-key export mirror and source capture, native red/green crash/concurrency/parity tests; production export path.
- [x] Reuse same changed-key mechanism for fit inputs with existing exact pair semantics and bounded bootstrap.
- [x] Semantic content revision, source/no-op delta handling where justified, native outcome tests and actual query-path integration.
- [x] Ready-score preparation / repeated prior reads and wake-lock regression; preserve producer generations and fairness.
- [x] Refine, review, scoped regressions, real indexed plans, bounded canary and reversible deployment; measured traffic receipt.
## TDD Progress (each unit)
- [x] Step1: Write failing test (RED)
- [x] Step2: Run test - CONFIRM it fails
- [x] Step3: Write minimal fix (GREEN)
- [x] Step4: Run test - CONFIRM it passes
- [x] Step5: Refactor if needed
- [x] Step6: Run test - CONFIRM still passes
## Verification Handoff
Native isolated PostgreSQL + SQLite tests, existing Jest/event materializer suite, changed-source typecheck; production EXPLAIN on bounded indexed candidates before schedule. Full source/canonical hash diff and backup manifest. Independent review if available under governing instructions; no unrelated tree edits.
## Risks and Rollback
Capture adds queue writes; coalesce pending marks and guard exact-generation claim/ack. Cache corruption validates local bodies before use; repair bounded by maxBytes. No source deletion. Leave additive tables/columns on rollback; restore scoped scripts as unit while affected jobs idle. Source changes can continue marking unused queues until capture is reverted safely.
## Stop Conditions and Budgets
No bulk live data reads without fresh usage check and explicit finite budget. Local fixture first. Production catalog/plan reads <=1MB per diagnostic batch, statement timeout10s and lock timeout1s. Bootstrap remains existing finite export/fit limits; do not silently expand them. Two failed fixes at same boundary require re-diagnosis. No provider move or new spending.

## Deployment progress
28a1805 installed 2026-10-13 6:52 PM ET. Additive trigger migrations committed before consumer cutover; online semantic index valid (51.2 MB). Bounded indexed production plans captured locally. Independent reviewer passed both rounds; no data deletion or R2 cutover. Snapshot admission capped at4Mkeys/50MBchanged bodies; fit canary1Mvideos/10Mpairs/50MBbodies. Fresh org usage674.798GB, $38.23 cycle egress overage; existing explicit deployment approval covers bounded validation. Final live receipts completed below.

## Recovery details
Mirror row completeness and server checkpoints reject missing rows and restored stale files. For an explicit rebuild, stop the dataset job, back up SQLite, change its capture-epoch metadata to a different value, and rerun with finite budgets; never manually forge server checkpoint. TRUNCATE invalidates capture epochs. SQL rollback is `sql/rollback/2026-10-13-incremental-database.sql` plus scoped file backups.

Semantic incremental scans use indexed change-key windows (5000 keys/page,100000 keys/run), preserving SQL timestamp microseconds. A capped catalog/identity pass now fails without advancing its watermark; large bursts still require bounded recovery instead of falsely reporting success. Existing raw history, mathematical scoring rules, RSS cadence and coverage remain intact.


## Completed live validation — 7:07 PM ET
Adaptive correction `abff9f4` installed at 7:01 PM ET after real producer reuse was only 7/5,475; a 16-event probe now avoids duplicate reads on cold batches. Native red/green and independent review passed. First adaptive scheduled run completed 939 videos / 3,076 deltas with 464,486 wire bytes and zero failures.

Snapshot admission: 186,012,561 wire bytes, 3,847,852 complete rows. Next live refresh: 249,062 bytes (99.87% lower for this interval), 666 changed bodies and 3,847,989 complete rows, identical full artifact format. No new R2 cutover/upload.

Fit admission safely hit its initial 50 MB changed-body cap; bounded 150 MB additional-body resume reused partial local content and completed 2,548,270 fitting pairs. Immediate second pass: same pair count, zero changed bodies, 1.255 seconds. Separate 5 MB-capped warm check: 847 actual database bytes, 1.352 seconds, same complete pair count. No training/model parameters were written by these canaries.

First three scheduled scorer runs scored 166/166, 175/175 and 166/166 ready targets, with zero deferrals or failures. Semantic 10-row dry check used 5,628 bytes without watermark changes. All 19 installed file hashes verified; all seven affected schedules loaded. Raw history, scoring math, cadence and R2 hold preserved.

Existing RSS provider HTTP 404/500 responses predate deployment and need separate diagnosis. Videos/video_scores mirrors still need initial scheduled admission. Full post-change daily bill and actual scheduled nightly model fit remain future measurements, not claimed savings. Canonical receipts: `/Users/brandoncullum/shared-memory/knowledge/projects/video-scripter/2026-10-13-supabase-egress/incremental-database-deployed.md` and `incremental-validation/`.
