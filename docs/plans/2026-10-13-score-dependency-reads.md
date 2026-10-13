# Avoid loading histories for scores that cannot run

Status: deployed and verified. Base: 810fd5a. Existing deployment approval applies; R2 remains held.

Observed: latest production run selected300, scored15, deferred285; each blocked batch first fetched every available target/prior blob and all prior metadata. Missing dependencies trigger materialization, so selection alone cannot skip missing targets without starving repairs.

Contract: query only IDs/watermarks first; request materialization for missing prerequisites as before; fetch bodies only for complete dependency sets. Revalidate bodies through the existing watermark-protected query so a concurrent observation blocks scoring. Preserve target/prior set, model math, raw evidence, cadence, coverage, repairs, byte limits, exact-generation acknowledgements. No schema change. Pending identical repair requests should not rewrite their queue rows.

Tests: missing target/prior => zero body/meta reads for blocked-only dependencies; shared ready priors loaded once; newly dirty dependency fails closed; empty/disabled cache and query failure behavior; real PostgreSQL old/new same-snapshot ready records parity and indexed bounded plan. Deploy only exact scoped files while scorer idle; backup/restore files; natural run verification and measured avoided loads. This reduces wasted reads, not all observation queue writes.

Verification: native PostgreSQL and unit fixtures pass; live warm-cache same-snapshot parity exact with96655→27581serialized bytes. Indexed plans readiness2.102ms/repair2.935ms. First production run300selected/46scored/254deferred,569256wirebytes,exit0. Backup logs/deploy-backups/20261013-143514-score-dependencies. Full scorer type errors match baseline; scoped libraries pass. Missing preflight reads counted in cache health after a follow-up correction.
