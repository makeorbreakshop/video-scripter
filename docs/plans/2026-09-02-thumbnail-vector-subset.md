---
title: Local thumbnail-vector subset experiment
status: active
artifact_readiness: implementation-ready
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
- Deduplication: one point per identical perceptual thumbnail hash, retaining linked video IDs in payload.

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
- [ ] Add the native WeMM worker and TypeScript orchestration script.
- [ ] Dry-run the 500-video cohort and verify database/Qdrant boundaries.
- [ ] Install the isolated local model runtime, embed the cohort, and smoke-test retrieval.
- [ ] Export a bounded retrieval-evaluation pool and record operational results.
- [ ] Run focused Jest, touched-file TypeScript, refinement, and independent review.

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
- Re-running is idempotent by perceptual hash. The test collection can be deleted without affecting existing semantic collections.

## Stop Conditions and Budgets

- Maximum 500 selected videos and 1,000 generated representations.
- No paid embedding API.
- Stop if WeMM cannot complete a one-image MPS smoke test; report the runtime incompatibility before considering a different model.
