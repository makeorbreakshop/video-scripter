---
title: Local thumbnail-vector subset experiment
status: complete
artifact_readiness: verified
execution: code
---

## Outcome

Create and run a reproducible 500-video thumbnail retrieval experiment using a local multimodal model and local Qdrant, without Pinecone or API endpoint changes.

## Non-goals and protected behavior

- Do not backfill the full video library.
- Do not add or change public API endpoints.
- Do not write to Postgres; read video/channel rows only by batches of IDs no larger than 5,000.
- Do not use Supabase JS or REST.
- Do not combine thumbnail vectors with the existing text-vector collections.
- Do not push or deploy.

## Prior Learnings

- The old CLIP thumbnail vectors are unavailable; Postgres retains only version markers.
- Earlier combined title/thumbnail experiments diluted semantic signal, so image-only and image-plus-title remain separate named representations.
- New-model benchmark claims are not ChannelSmith evidence. WeMM-4B must earn expansion on a fixed judged cohort.

## Key Decisions

- Source cohort: existing `videos_v1` 30-day Qdrant collection, enriched from Postgres by primary-key batches.
- Cohort: deterministic and stratified by topic, format, outlier status, and channel-size band, with a per-channel cap.
- Model: `tencent/WeMM-Embedding-4B`, 512 dimensions, native macOS process.
- Store: `thumbnails_wemm4b_test_v1` in local Qdrant with named `visual` and `visual_title` vectors.
- Deduplication: one point per exact normalized-image SHA-256, retaining linked video IDs in payload; perceptual hash remains diagnostic only.

## Acceptance Contract

- Pure cohort selection is deterministic, respects the per-channel cap, and preserves forced test IDs when available.
- Payload mapping is stable and retains provenance, model, dimension, and visual hash.
- Qdrant collection configuration contains two independent 512-dimensional cosine vectors.
- A dry run produces exactly the requested eligible cohort without downloading or embedding.
- A real run embeds the bounded cohort locally, upserts only the test collection, and records counts/failures.
- At least one real image-to-image query returns distinct neighbors from both representations.

## Work Units

- [x] Add failing Jest contracts for cohort selection, payload mapping, and named-vector configuration.
- [x] Implement the pure thumbnail experiment module and make focused tests pass.
- [x] Add the native WeMM worker and TypeScript orchestration script.
- [x] Dry-run the 500-video cohort and verify database/Qdrant boundaries.
- [x] Install the isolated local model runtime, embed the cohort, and smoke-test retrieval.
- [x] Export a bounded retrieval-evaluation pool and record operational results.
- [x] Run focused Jest, touched-file TypeScript, refinement, and independent review.

## Verification Handoff

- `npx jest lib/semantic/thumbnails.test.ts`
- `npx jest lib/semantic`
- `npx tsc --noEmit`
- `npx tsx scripts/semantic/embed-thumbnails.ts --limit 500 --dry-run`
- `npx tsx scripts/semantic/embed-thumbnails.ts --limit 500`
- `npx tsx scripts/semantic/eval-thumbnails.ts`

## Risks and Rollback

- Apple MPS may not support the newly released model. The runner must fail clearly without touching existing collections; CPU fallback requires an explicit flag.
- Remote thumbnail downloads may fail. Record failures and do not fabricate vectors.
- A validated rebuild recreates only the isolated test collection and uses exact normalized-image SHA-256 identity. The collection can be deleted without affecting existing semantic collections.

## Stop Conditions and Budgets

- Maximum 500 selected videos and 1,000 generated representations.
- No paid embedding API.
- Stop if WeMM cannot complete a one-image MPS smoke test; report the runtime incompatibility before considering a different model.

## Result

- MPS gate passed; 500 downloads produced 498 unique Qdrant points with no failures.
- Exact retrieval latency was 1.58 ms p50 and 1.93 ms p95 on the test collection.
- Independent title-blind review narrowly favored `visual` (1.69/3, P≥2 0.64) over `visual_title` (1.65/3, P≥2 0.55), but the 9–9–2 seed-set split is not decisive.
- No product endpoint or full backfill was added. See `docs/prd/2026-09-03-thumbnail-vector-eval.md`.
