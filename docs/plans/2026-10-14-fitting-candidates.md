---
title: Reuse unchanged paid fitting history and committed API observations
status: active
artifact_readiness: implementation-ready
execution: code
---
## Outcome
Reduce nightly paid fitting historical result bytes and API materialization observation bytes without changing model inputs, raw data, schedules or coverage.
## Non-goals and protected behavior
R2 migration remains held. Original unordered LIMIT60000 fitting selection and math retained. Longtail/past30 queries remain original: measured only1.58MB/day, broader cache/capture not justified.
## Prior Learnings
Existing mirror verifies server MD5 against held local bodies. Candidate bytes are hints accepted only with committed event digest. Snapshot updates produce delete+upsert events; both needed to exceed adaptive80% reuse threshold.
## Key Decisions
Use selected-ID fingerprint fitting mirror, no new database schema/capture writes. Cache only source points day0..24 (largest pre30 bucket21±3) and selected day30 truth. Exact different-value SQL ties fallback to original bounded reads. Re-evaluate original selection each run, so window expiry remains current. API collector remembers candidates after COMMIT; digest mismatch/missing hooks use authoritative fallback.
## Acceptance Contract
Native PostgreSQL fixture: unchanged fitting second run transfers<25% cold bytes with identical FitRows/params; mutation/deletion/restart/ties/budgets preserve behavior. Mixed-source API candidate native fixture yields exact observations and<60% rawbytes; conflicts/transformations fallback.
## Work Units
- [x] Main fitting TDD and implementation
- [x] API candidates TDD and implementation
- [ ] Refine, scoped regression and parent independent review
- [ ] Deploy backed-up scoped runtime files while affected jobs idle; bounded canaries
## TDD Progress
Main fitting:
- [x] Step1 write failing outcome test
- [x] Step2 confirm expected RED
- [x] Step3 minimal GREEN
- [x] Step4 confirm pass
- [x] Step5 refine
- [x] Step6 confirm still pass
API candidates:
- [x] Step1 write failing outcome test
- [x] Step2 confirm expected RED
- [x] Step3 minimal GREEN
- [x] Step4 confirm pass
- [x] Step5 refine
- [x] Step6 confirm still pass
## Verification Handoff
Base6818fe6. Native node/tsx PostgreSQL fixtures, then parent independent diff/test review before deployment.
## Risks and Rollback
Legacy ties unspecified; fallback rather than invented tie ordering. Candidate optional cache never authorizes source bytes. Backup affected canonical files, minimal patch launch-track to preserve unrelated canonical changes. Restore backups on failed canary.
## Stop Conditions and Budgets
No live corpus bootstrap/fullfit during implementation. Per fitting run: selected60000ids,500ids/page,16MB/page,100MBtotal changedbody ceiling; bounded ambiguous fallback50001rows/page with totalbyte ceiling. Initial cache no larger than nightly subset. Usage checked by parent9:08AM ET682.635GB/$38.94overage; explicit deploy/test authorization. Live smoke<=5MB returnedbytes expected, never silently fall back to fullfit.

## Receipts
- Main RED: native original-query fixture unchanged history44027bytes cold and44027bytes warm; failed expected `<cold/4` assertion before helper existed.
- API RED: actual batch50samples+50snapshotupdates failed `<raw*0.6` before putApi; adaptive authoritative fallback preserved exact rows.
- GREEN/refine: native5fixtures pass; real production snapshot/sample statement-trigger functions exercised with actual writeSampleBatch. Native tests cover60videoQbins, µs epsilon, mutation, deletion, restart, corruptbody, cachepruning, tie fallback, SQL-transformed candidate rejection.
- Jest4suites71tests passed. Logs in receipts/2026-10-14-paid-fit-{native-green,jest}.txt.
- No live corpus bootstrap; no schema changes. Longtail/past30 retained because measured1.58MB/day does not justify all-corpus/capture expansion.

## Independent review and live gate
Parent independently reran native5fixtures and diffcheck on e7c21f9: PASS, no blocking findings. Predeploy read-only repeatable-read live20IDcanary seeded from existing local snapshot mirror:463legacyrows,50FitRows exact parameter parity; newpage191.513ms EXPLAIN ANALYZE, no source sequential scans. Serialized results cold9216bytes,warm62bytes,total68877bytes inclplan+legacy (these are not wire). First scheduled fullfit will still cold-populate cache under100MB cap. No fullfit savings estimate claimed.
Scoped strict helper TypeScript compilation passes; full repo compiler retains existing top-level await/module configuration and other unrelated errors.
