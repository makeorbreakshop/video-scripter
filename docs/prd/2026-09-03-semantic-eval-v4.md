# Semantic retrieval v4 evaluation

Status: generated from frozen revision-4 artifacts. This is a diagnostic evaluation, not a production-route approval. Confidence intervals are descriptive because each lane has only one or two tasks per split.

## Corpus and judging

- Video corpus: 9385 guarded one-year outliers.
- Channel corpus: 3544 channels.
- Pooled non-J1 judgments: 2196; initial agreement 0.617; adjudicated 841; unresolved 35.
- Semantic cost ledger today: $0.367486 for 11,854,097 tokens, including earlier revision-4 retries/experiments today.

## J1 exact-channel MRR

| Split | Task | System | MRR |
| --- | --- | --- | --- |
| dev | j1-make-or-break | lexical_bm25 | 1.000 |
| dev | j1-make-or-break | openai_dense | 0.036 |
| dev | j1-make-or-break | rrf_control | 0.200 |
| heldout | j1-mkbhd | lexical_bm25 | 1.000 |
| heldout | j1-mkbhd | openai_dense | 0.125 |
| heldout | j1-mkbhd | rrf_control | 0.333 |

## Held-out nDCG@20

| Lane | Measure | System | Mean | 95% CI | Tasks |
| --- | --- | --- | --- | --- | --- |
| J2 | ndcg@20 | lexical_bm25 | 0.160 | 0.160–0.160 | 1 |
| J2 | ndcg@20 | openai_dense | 0.525 | 0.525–0.525 | 1 |
| J2 | ndcg@20 | rrf_control | 0.432 | 0.432–0.432 | 1 |
| J3 | packaging_ndcg@20 | lexical_bm25 | 0.367 | 0.271–0.463 | 2 |
| J3 | packaging_ndcg@20 | openai_dense | 0.510 | 0.385–0.635 | 2 |
| J3 | packaging_ndcg@20 | rrf_control | 0.468 | 0.407–0.528 | 2 |
| J3 | topic_ndcg@20 | lexical_bm25 | 0.331 | 0.201–0.461 | 2 |
| J3 | topic_ndcg@20 | openai_dense | 0.681 | 0.571–0.791 | 2 |
| J3 | topic_ndcg@20 | rrf_control | 0.542 | 0.421–0.663 | 2 |
| J4 | ndcg@20 | lexical_bm25 | 0.570 | 0.234–0.906 | 2 |
| J4 | ndcg@20 | openai_dense | 0.552 | 0.523–0.582 | 2 |
| J4 | ndcg@20 | rrf_control | 0.685 | 0.579–0.792 | 2 |
| J5 | lower_ndcg@20 | lexical_bm25 | 0.056 | 0.000–0.112 | 2 |
| J5 | lower_ndcg@20 | openai_dense | 0.000 | 0.000–0.000 | 2 |
| J5 | lower_ndcg@20 | rrf_control | 0.021 | 0.000–0.043 | 2 |
| J5 | upper_ndcg@20 | lexical_bm25 | 0.095 | 0.000–0.190 | 2 |
| J5 | upper_ndcg@20 | openai_dense | 0.017 | 0.000–0.035 | 2 |
| J5 | upper_ndcg@20 | rrf_control | 0.038 | 0.000–0.075 | 2 |

## Dev nDCG@20

| Lane | Measure | System | Mean | 95% CI | Tasks |
| --- | --- | --- | --- | --- | --- |
| J2 | ndcg@20 | lexical_bm25 | 0.899 | 0.818–0.981 | 2 |
| J2 | ndcg@20 | openai_dense | 0.913 | 0.848–0.978 | 2 |
| J2 | ndcg@20 | rrf_control | 0.898 | 0.817–0.979 | 2 |
| J3 | packaging_ndcg@20 | lexical_bm25 | 0.437 | 0.437–0.437 | 1 |
| J3 | packaging_ndcg@20 | openai_dense | 0.454 | 0.454–0.454 | 1 |
| J3 | packaging_ndcg@20 | rrf_control | 0.437 | 0.437–0.437 | 1 |
| J3 | topic_ndcg@20 | lexical_bm25 | 0.968 | 0.968–0.968 | 1 |
| J3 | topic_ndcg@20 | openai_dense | 0.982 | 0.982–0.982 | 1 |
| J3 | topic_ndcg@20 | rrf_control | 0.971 | 0.971–0.971 | 1 |
| J4 | ndcg@20 | lexical_bm25 | 0.510 | 0.313–0.708 | 2 |
| J4 | ndcg@20 | openai_dense | 0.899 | 0.798–1.000 | 2 |
| J4 | ndcg@20 | rrf_control | 0.864 | 0.839–0.890 | 2 |
| J5 | lower_ndcg@20 | lexical_bm25 | 0.000 | 0.000–0.000 | 2 |
| J5 | lower_ndcg@20 | openai_dense | 0.000 | 0.000–0.000 | 2 |
| J5 | lower_ndcg@20 | rrf_control | 0.000 | 0.000–0.000 | 2 |
| J5 | upper_ndcg@20 | lexical_bm25 | 0.000 | 0.000–0.000 | 2 |
| J5 | upper_ndcg@20 | openai_dense | 0.000 | 0.000–0.000 | 2 |
| J5 | upper_ndcg@20 | rrf_control | 0.000 | 0.000–0.000 | 2 |

## Held-out precision@10 and copying rate

| Lane | Measure | System | Mean | 95% CI |
| --- | --- | --- | --- | --- |
| J2 | precision@10 | lexical_bm25 | 0.600 | 0.600–0.600 |
| J2 | precision@10 | openai_dense | 0.900 | 0.900–0.900 |
| J2 | precision@10 | rrf_control | 0.800 | 0.800–0.800 |
| J3 | packaging_precision@10 | lexical_bm25 | 0.650 | 0.500–0.800 |
| J3 | packaging_precision@10 | openai_dense | 0.800 | 0.600–1.000 |
| J3 | packaging_precision@10 | rrf_control | 0.800 | 0.600–1.000 |
| J3 | topic_precision@10 | lexical_bm25 | 0.600 | 0.500–0.700 |
| J3 | topic_precision@10 | openai_dense | 1.000 | 1.000–1.000 |
| J3 | topic_precision@10 | rrf_control | 1.000 | 1.000–1.000 |
| J4 | precision@10 | lexical_bm25 | 0.300 | 0.300–0.300 |
| J4 | precision@10 | openai_dense | 0.200 | 0.100–0.300 |
| J4 | precision@10 | rrf_control | 0.350 | 0.300–0.400 |
| J5 | direct_application_rate@10 | lexical_bm25 | 0.750 | 0.500–1.000 |
| J5 | direct_application_rate@10 | openai_dense | 1.000 | 1.000–1.000 |
| J5 | direct_application_rate@10 | rrf_control | 0.900 | 0.800–1.000 |
| J5 | lower_precision@10 | lexical_bm25 | 0.100 | 0.000–0.200 |
| J5 | lower_precision@10 | openai_dense | 0.000 | 0.000–0.000 |
| J5 | lower_precision@10 | rrf_control | 0.050 | 0.000–0.100 |
| J5 | upper_precision@10 | lexical_bm25 | 0.150 | 0.000–0.300 |
| J5 | upper_precision@10 | openai_dense | 0.000 | 0.000–0.000 |
| J5 | upper_precision@10 | rrf_control | 0.050 | 0.000–0.100 |

## Pooled recall@100

| Split | Lane | Measure | System | Mean | 95% CI |
| --- | --- | --- | --- | --- | --- |
| dev | J2 | pooled_recall@100 | lexical_bm25 | 0.702 | 0.677–0.726 |
| dev | J2 | pooled_recall@100 | openai_dense | 0.799 | 0.752–0.846 |
| dev | J2 | pooled_recall@100 | rrf_control | 0.755 | 0.714–0.795 |
| dev | J3 | packaging_pooled_recall@100 | lexical_bm25 | 0.687 | 0.687–0.687 |
| dev | J3 | packaging_pooled_recall@100 | openai_dense | 0.663 | 0.663–0.663 |
| dev | J3 | packaging_pooled_recall@100 | rrf_control | 0.723 | 0.723–0.723 |
| dev | J3 | topic_pooled_recall@100 | lexical_bm25 | 0.547 | 0.547–0.547 |
| dev | J3 | topic_pooled_recall@100 | openai_dense | 0.905 | 0.905–0.905 |
| dev | J3 | topic_pooled_recall@100 | rrf_control | 0.737 | 0.737–0.737 |
| dev | J4 | pooled_recall@100 | lexical_bm25 | 0.972 | 0.944–1.000 |
| dev | J4 | pooled_recall@100 | openai_dense | 0.969 | 0.938–1.000 |
| dev | J4 | pooled_recall@100 | rrf_control | 1.000 | 1.000–1.000 |
| dev | J5 | lower_pooled_recall@100 | lexical_bm25 | 1.000 | 1.000–1.000 |
| dev | J5 | lower_pooled_recall@100 | openai_dense | 0.000 | 0.000–0.000 |
| dev | J5 | lower_pooled_recall@100 | rrf_control | 0.475 | 0.450–0.500 |
| dev | J5 | upper_pooled_recall@100 | lexical_bm25 | 0.972 | 0.944–1.000 |
| dev | J5 | upper_pooled_recall@100 | openai_dense | 0.028 | 0.000–0.056 |
| dev | J5 | upper_pooled_recall@100 | rrf_control | 0.490 | 0.480–0.500 |
| heldout | J2 | pooled_recall@100 | lexical_bm25 | 0.452 | 0.452–0.452 |
| heldout | J2 | pooled_recall@100 | openai_dense | 0.659 | 0.659–0.659 |
| heldout | J2 | pooled_recall@100 | rrf_control | 0.548 | 0.548–0.548 |
| heldout | J3 | packaging_pooled_recall@100 | lexical_bm25 | 0.509 | 0.471–0.548 |
| heldout | J3 | packaging_pooled_recall@100 | openai_dense | 0.634 | 0.607–0.661 |
| heldout | J3 | packaging_pooled_recall@100 | rrf_control | 0.573 | 0.562–0.583 |
| heldout | J3 | topic_pooled_recall@100 | lexical_bm25 | 0.410 | 0.337–0.484 |
| heldout | J3 | topic_pooled_recall@100 | openai_dense | 0.783 | 0.677–0.888 |
| heldout | J3 | topic_pooled_recall@100 | rrf_control | 0.623 | 0.573–0.674 |
| heldout | J4 | pooled_recall@100 | lexical_bm25 | 0.875 | 0.750–1.000 |
| heldout | J4 | pooled_recall@100 | openai_dense | 1.000 | 1.000–1.000 |
| heldout | J4 | pooled_recall@100 | rrf_control | 0.917 | 0.833–1.000 |
| heldout | J5 | lower_pooled_recall@100 | lexical_bm25 | 0.950 | 0.900–1.000 |
| heldout | J5 | lower_pooled_recall@100 | openai_dense | 0.100 | 0.100–0.100 |
| heldout | J5 | lower_pooled_recall@100 | rrf_control | 0.425 | 0.350–0.500 |
| heldout | J5 | upper_pooled_recall@100 | lexical_bm25 | 0.905 | 0.810–1.000 |
| heldout | J5 | upper_pooled_recall@100 | openai_dense | 0.131 | 0.071–0.190 |
| heldout | J5 | upper_pooled_recall@100 | rrf_control | 0.405 | 0.310–0.500 |

## Retrieval latency

| System | Tasks | p50 ms | p95 ms |
| --- | --- | --- | --- |
| lexical_bm25 | 16 | 10.6 | 49.2 |
| openai_dense | 16 | 28.4 | 78.2 |
| rrf_control | 16 | 0.1 | 0.4 |

## Decision

- J1 known-channel retrieval stays lexical: held-out MRR is 1.000 versus 0.125 dense and 0.333 RRF.
- J2/J3 dense retrieval is useful: held-out J2 nDCG@20 is 0.525, and J3 dense topic precision@10 is 1.000.
- J4 has candidates but does not pass the quality bar: its best held-out precision@10 is RRF at 0.350, below 0.600.
- J5 fails the creative-transfer job. Held-out lower-bound creative precision@10 is 0.100 lexical, 0.000 dense, and 0.050 RRF; direct-application rates are 0.750, 1.000, and 0.900.

The selected §8 challenger is dynamic purpose/mechanism extraction and explicit transfer verification for J5, developed only on the original dev tasks. Do not add a global reranker, corpus-wide facets, or endpoints. Freeze a new confirmation set before evaluating the challenger.

## Gate status

No production-route gate passes on this diagnostic set. Any challenger must be frozen and evaluated on a new confirmation set, and J5 cannot claim a win while unresolved top-10 judgments remain. Brandon's blinded 20-item calibration packet is in `docs/prd/semantic-eval-v4/brandon-spot-check.json`.
