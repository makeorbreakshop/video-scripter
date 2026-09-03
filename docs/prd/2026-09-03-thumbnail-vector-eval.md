# Thumbnail Vector Subset Evaluation

Date: 2026-09-03

Status: completed experiment; not approved for product rollout

## Decision

Local WeMM-Embedding-4B works on this Mac and produces useful thumbnail candidate-generation signal. Keep `visual` and `visual_title` separate. Image-only `visual` is the narrow winner on this small review, but the result is effectively a tie and neither representation has earned endpoint integration or a full-catalog backfill.

## Configuration

| Item | Value |
|---|---|
| Model | `tencent/WeMM-Embedding-4B` |
| Pinned revision | `a28b25c5d18cf71ec46b115e06ea79ab00ee4819` |
| License | Apache-2.0 |
| Dimensions | 512, L2-normalized |
| Device | Apple MPS |
| Preprocessing | EXIF transpose, RGB, fit within 640×640, JPEG quality 95 |
| Store | local Qdrant `thumbnails_wemm4b_test_v1` |
| Named vectors | `visual`, `visual_title` |
| Paid embedding cost | $0 |

The model and 512-dimensional truncation are supported by the [official model card](https://huggingface.co/tencent/WeMM-Embedding-4B). The exact model revision and preprocessing recipe are stored on every point.

## Cohort and indexing

The source was the current 30-day `videos_v1` Qdrant collection. Postgres enrichment used only `WHERE id = ANY(...)` and `WHERE channel_id = ANY(...)` batches capped at 5,000 IDs.

| Measure | Result |
|---|---:|
| Source/eligible videos | 47,769 / 47,769 |
| Selected videos | 500 |
| Distinct channels | 380 |
| Maximum videos per channel | 3 |
| Selected outliers / ordinary | 250 / 250 |
| Channel size bands | 100 in each of five bands |
| Successful thumbnail downloads | 500 |
| Download failures | 0 |
| Unique exact normalized images | 498 |
| Unique perceptual hashes | 498 |
| Exact duplicates collapsed | 2 |
| Perceptual-hash collisions | 0 |
| Qdrant points upserted | 498 |
| End-to-end run time | 517.0 seconds |

All 30-day candidates had null `topic_domain`, `niche`, and `format_type`, so topic/format stratification was impossible. The selector still balanced outlier status and the five channel-size bands exactly. No missing labels were inferred or invented.

## Retrieval diagnostics

Twenty deterministic seed thumbnails were queried against both named vectors. Each query used exact search over the 498-point collection and returned five non-self neighbors.

| Diagnostic | `visual` | `visual_title` | Cross-variant |
|---|---:|---:|---:|
| Cross-channel neighbor rate | 0.97 | 0.96 | — |
| Mean lexical title-token overlap | 0.0175 | 0.0286 | — |
| Top-five list overlap | — | — | 0.34 |

The low title-token overlap shows that `visual_title` did not collapse into literal title matching. The 34% neighbor overlap confirms that the two representations answer materially different retrieval questions.

| Exact Qdrant latency, 40 queries | Result |
|---|---:|
| p50 | 1.58 ms |
| p95 | 1.93 ms |
| maximum | 3.04 ms |

This latency is a small-collection exact-scan result, not a full-catalog HNSW forecast.

## Blind image judgment

An independent Codex evaluator reviewed 100 neighbors per representation from title-blind contact sheets. The rubric was 0 = no meaningful match, 1 = superficial resemblance, 2 = useful visual/packaging analogue, and 3 = strong match. Cosine scores were hidden from the judgment.

| Representation | Mean relevance (0–3) | Precision at score ≥2 | Seed-set wins |
|---|---:|---:|---:|
| `visual` | **1.69** | **0.64** | 9 |
| `visual_title` | 1.65 | 0.55 | 9 |
| Ties | — | — | 2 |

`visual` wins narrowly on aggregate, but the 9–9–2 split is not a decisive model-selection result.

| Score distribution | 0 | 1 | 2 | 3 |
|---|---:|---:|---:|---:|
| `visual` | 7 | 29 | 52 | 12 |
| `visual_title` | 5 | 40 | 40 | 15 |

Strong `visual` results included microwave hacks → dorm cooking and notebook/self-improvement → planner/notebook-method thumbnails. Strong `visual_title` results included Zelensky → sanctions/drone/geopolitics graphics and eufyMake income → xTool/FlashForge maker-business thumbnails.

Failures were also clear: both variants failed an Outer Banks/Netflix montage; `visual` mapped craft supplies to generic vertical talking-head thumbnails; `visual_title` drifted microwave cooking toward ham-radio/tools; and an institutional cancer-course graphic retrieved unrelated conference, food, and book designs.

## Operational footprint

| Artifact | Size |
|---|---:|
| Pinned model cache | 9.7 GB |
| Raw and normalized image cache | 109 MB |
| Qdrant test collection on disk | 133 MB |

Peak inference RAM was not instrumented. The model completed batch-size-8 MPS inference without an out-of-memory failure on the 64 GB machine.

## What this proves—and what it does not

This proves that a local, non-Pinecone thumbnail index is technically viable, that named image-only and image-plus-title vectors behave differently, and that WeMM has enough signal to justify a better evaluation.

It does not prove product usefulness or justify scaling. The judged sample has only 20 seeds, one AI judge, visible row identity (`A` versus `B`), no second-label agreement, no held-out creator task, and no baseline model such as CLIP or Qwen3-VL. Apparent vertical-format items were visible, but video duration was not fetched, so Shorts contamination was not verified.

The next gate should be a randomized, task-specific judged pool with representation identity hidden, at least two judges, and concrete tasks such as “find the same visual trope” versus “find transferable packaging.” Add a baseline model and report confidence intervals before choosing a production variant.

## Reproduction

```bash
PYTHON_BIN=/path/to/python3.11 scripts/semantic/setup-thumbnails.sh
npx tsx scripts/semantic/embed-thumbnails.ts --limit 500 --dry-run
npx tsx scripts/semantic/embed-thumbnails.ts --limit 500 --batch-size 8 --device mps
npx tsx scripts/semantic/eval-thumbnails.ts --seeds 20 --neighbors 5 \
  --seed-file docs/prd/semantic-thumbnail-judgments.json
tmp/semantic-thumbnails-venv/bin/python scripts/semantic/render-thumbnail-eval.py \
  --pool docs/prd/semantic-thumbnail-retrieval-pool.json \
  --image-cache tmp/semantic-thumbnail-images \
  --output-dir tmp/semantic-thumbnail-eval-sheets
```

The frozen cohort is in `semantic-thumbnail-cohort.json`; machine-readable run results are in `semantic-thumbnail-results.json`; the retrieval pool is in `semantic-thumbnail-retrieval-pool.json`; and the rank-level judgments are in `semantic-thumbnail-judgments.json`. The canonical judged neighbor-ID ranking hash is `e1d7487aff422ce83706a52c8a975427407a3ffb162fb891765a75ca3ea34405`; the evaluator now verifies it before replacing the pool artifact.
