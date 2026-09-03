# Semantic eval v2 — current local status

Generated: Sep 3, 2026, 8:47:20 AM EDT

This report is generated from JSON/database state by `scripts/semantic/render-eval-v2-report.ts`. Do not hand-edit.

## Frozen eval manifest

Content hash: `082accf4a9daa7c13e724902d2c4a0db254de7327e26e73fd2410b1f90ecd913`

| Job | Frozen queries/seeds |
|---|---:|
| J1 | 100 |
| J2 | 50 |
| J3 | 50 |
| J4 | 40 |
| J5 | 30 |

## Phase 0 score coverage

| Model | Rows | Numeric scores | Trusted outliers | Channels |
|---|---:|---:|---:|---:|
| v3.1-semantic-backfill-2026-09 | 95164 | 93742 | 21653 | 4328 |

## Centroid audit

| Created date | Rows | <5 source clusters | Placeholder hierarchy rows |
|---|---:|---:|---:|
| 2025-07-11 | 892 | 694 | 647 |
| 2025-08-03 | 216 | 0 | 0 |

Decision: Use August 2025 216 centroids only for shadow assignment/eval. Exclude July 2025 rows with low source counts or placeholder hierarchy from v2 canonical topic assignment.

## Facet pilot

| Prompt/model | Rows | With required abstractions | Packaging-only evidence |
|---|---:|---:|---:|
| semantic_facets_v2_2026_09_03 / gpt-5-nano | 204 | 204 | 204 |

Review packet: `docs/prd/semantic-eval-v2/facet-pilot-review.json`.

## videos_v2 / channel medoids

| Collection | Points |
|---|---:|
| videos_v2 | 204 |

| Prototype kind | Prototypes | Channels |
|---|---:|---:|
| purpose | 171 | 102 |
| topic | 169 | 102 |

## Gate table

| Status | Evidence |
|---|---|
| pass | Phase 0 mature score backfill completed: annual mature outlier pool now has versioned v3.1 coverage. |
| pass | Eval manifest is frozen before v2 systems are evaluated. |
| fail | J4 topic coverage from canonical topic columns is currently zero for the 40 human-readable topic strings; topic assignment/facets must carry topical search. |
| pending | Centroid shadow assignment threshold is not accepted: 0.65 assigned only 10/300; needs judged calibration or topic rebuild. |
| pending | Facet pilot produced structurally valid rows, but Brandon review packet is not accepted yet; do not scale extraction. |
| pending | Reranker, fusion comparison, analogue composite, and held-out nDCG/Recall tables are not run yet. |

## Cost

Today's semantic ledger total: 8078109 tokens, $0.291966. This includes prior semantic work today, not only v2 facets.
