# Avoid loading histories for scores that cannot run

Status: deployed and verified. Base: 810fd5a. Existing deployment approval applies; R2 remains held.

Observed: latest production run selected300, scored15, deferred285; each blocked batch first fetched every available target/prior blob and all prior metadata. Missing dependencies trigger materialization, so selection alone cannot skip missing targets without starving repairs.

Contract: query only IDs/watermarks first; request materialization for missing prerequisites as before; fetch bodies only for complete dependency sets. Revalidate bodies through the existing watermark-protected query so a concurrent observation blocks scoring. Preserve target/prior set, model math, raw evidence, cadence, coverage, repairs, byte limits, exact-generation acknowledgements. No schema change. Pending identical repair requests should not rewrite their queue rows.

Tests: missing target/prior => zero body/meta reads for blocked-only dependencies; shared ready priors loaded once; newly dirty dependency fails closed; empty/disabled cache and query failure behavior; real PostgreSQL old/new same-snapshot ready records parity and indexed bounded plan. Deploy only exact scoped files while scorer idle; backup/restore files; natural run verification and measured avoided loads. This reduces wasted reads, not all observation queue writes.

Verification: native PostgreSQL and unit fixtures pass; live warm-cache same-snapshot parity exact with96655→27581serialized bytes. Indexed plans readiness2.102ms/repair2.935ms. First production run300selected/46scored/254deferred,569256wirebytes,exit0. Backup logs/deploy-backups/20261013-143514-score-dependencies. Full scorer type errors match baseline; scoped libraries pass. Missing preflight reads counted in cache health after a follow-up correction.

## Follow-up authorized October13: TDD coordinated processing

Base b238a79. Preserve raw data, channel coverage, polling/scoring math, durable archive verification and R2 hold.

Work units:
1. Durable missing-dependency waits with bounded15minute crash fallback; materializer/bootstrap completion wakes only fully ready target sets. Prioritize requested observation builds with half of materializer capacity, retaining FIFO capacity. Exact-generation wait/update prevents stale acknowledgements. Nullable additive metadata and concurrent indexes; old code remains compatible. No new triggers or producer changes.
2. Test complete export assembly (mutations/deletions/restart/caps) and verify existing warm snapshot mirror with bounded live scan; no unscheduled publish or incomplete corpus admitted.
3. Investigate historical reuse with exact input coverage. Implement only a bounded validated reuse path that preserves original fit inputs; otherwise explicitly record which missing provenance blocks replacing the existing read. No lower-fidelity collection.

TDD Progress — coordinated processing:
- [x] Step 1: Write failing test (RED)
- [x] Step 2: Run test - CONFIRM it fails
- [x] Step 3: Write minimal fix (GREEN)
- [x] Step 4: Run test - CONFIRM it passes
- [x] Step 5: Refactor if needed
- [x] Step 6: Run test - CONFIRM still passes

Acceptance: blocked scores not selected until complete or recovery deadline; cache completion before/after wait cannot strand work; missing/legacy/dirty dependency cannot wake; concurrent new score generation survives; replay/idempotence; rollback leaves no partial wake; requested cache work gets capacity without starving FIFO; bounded rows/bytes and indexed production plans. Restore old modules while workers idle for rollback, leave nullable columns harmless. Live probes capped, do not run full fit or change provider routing.


Follow-up verification (before deployment):
- Confirmed RED before fixes: missing durable wait; corrupt held export body reused; unchanged launch histories retransferred; 200001-video enumeration limit; large priority blobs starving FIFO under byte cap. All corrected and GREEN, with refactor reruns.
- 39 unit tests in six suites, five native PostgreSQL scenarios, and15 event/materialization integration tests pass. The older integration fixture needed its missing day30 column/table cleanup updated to match its existing migration.
- Scoped changed libraries typecheck. Entrypoint type diagnostics exactly match the canonical baseline (existing packaging types and bootstrap union narrowing); no new errors.
- Production plans: full materializer20000-video/25MB configuration returned3357eligible rows in5941ms through due/requested/pkey indexes. Wait/wake use exact generations and GIN overlap. FIFO now receives a byte reservation as well as video slots; large priority blobs join FIFO when both lanes need space. Limits and observations remain unchanged.
- Launch enumeration now uses the existing publish/id index-only scan:217819IDs in3292ms, finite1million-ID guard. Eligibility remains unchanged within bounded500-ID probes. Real read-only same-snapshot canary500videos/33742source rows/9569pairs has exact input multiset AND fitted-model parity. Legacy496383serialized bytes; cold403948; warm63 (excludes enumeration/metadata). Native test covers corrections, deletions, restart, ambiguous day1 fallback, row/byte caps. Nightly250MBchanged-body/10million-pair hard guards fail before candidate publication; no active model is directly promoted. Incomplete raw archives are not used as complete fitting inputs.
- Organization usage checked before full export validation:671.284GBuncached/250GBincluded, Sep17–Oct17, $37.92overage; existing explicit deployment/fix approval applies. One full warm snapshot dry run has50MBchanged-body and4million-key caps; key traffic is additional (expected~150MB). No upload, no R2 migration/cost change. Result pending.
- Sequential Standards and Spec review: preserve raw capture, collection cadence, source authority, exact-generation clears and R2 hold; nullable schema can remain on rollback. Runtime deployment must back up the exact scoped files and restart only idle workers.
