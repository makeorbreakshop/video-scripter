# Semantic programmatic packaging-transfer experiment

Date: 2026-09-03. Status: failed; stop condition applied.

## Outcome

The sole eligible primary, `cross_topic_diverse`, **failed** the literal per-task gate. No variant advances, and the diagnostic ablations cannot rescue it.

This was a fully local, deterministic rerank of 312 task-candidate pairs (304 unique videos). It made no LLM call, embedding call, database write, or endpoint change. Incremental paid cost was **$0.00**; total semantic spend remains conservatively bounded at **$0.898715**.

## Results

| Target | Variant | strict P@10 | unresolved→relevant P@10 | strict nDCG@20 | unresolved→relevant nDCG@20 | direct@10 | unresolved@10 | creative@10 | channels@10 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Make or Break Shop | `title_form` | 0.100 | 0.200 | 0.061 | 0.116 | 0.800 | 1 | 1 | 9 |
| Make or Break Shop | `cross_topic` | 0.600 | 0.900 | 0.458 | 0.702 | 0.100 | 3 | 6 | 9 |
| Make or Break Shop | `cross_topic_diverse` | 0.600 | 0.900 | 0.520 | 0.788 | 0.100 | 3 | 6 | 9 |
| Marques Brownlee | `title_form` | 0.000 | 0.000 | 0.050 | 0.078 | 1.000 | 0 | 0 | 10 |
| Marques Brownlee | `cross_topic` | 0.200 | 0.200 | 0.411 | 0.388 | 0.700 | 0 | 2 | 9 |
| Marques Brownlee | `cross_topic_diverse` | 0.400 | 0.500 | 0.453 | 0.437 | 0.400 | 1 | 4 | 8 |

The unresolved→relevant columns are sensitivity calculations, not guaranteed numeric upper bounds for normalized nDCG because the ideal denominator also changes. The primary gate is applied to each task independently: strict P@10 >= 0.300, direct@10 <= 0.200, creative@10 >= 1, unresolved@10 = 0, and channels@10 >= 8. Failures: j5-maker-transfer: unresolved_at_k 3 > 0; j5-tech-transfer: direct_application_rate_at_k 0.4 > 0.2; j5-tech-transfer: unresolved_at_k 1 > 0.

## Ablation delta: primary minus title-form only

| Target | Δ strict P@10 | Δ strict nDCG@20 | Δ direct@10 |
|---|---:|---:|---:|
| Make or Break Shop | 0.500 | 0.459 | -0.700 |
| Marques Brownlee | 0.400 | 0.403 | -0.600 |

## Coverage and provenance

- Candidate video vectors: 304/304.
- Source-channel vectors: 121/141; missing sources fell back to candidate-video affinity exactly as frozen.
- Thumbnail pilot overlap: 0/304; thumbnails were therefore excluded.
- Exact blind document versus vector-document mismatches: 0.
- End-to-end local replay latency: 1061.2 ms.
- Recipe: 0.60 inverse maximum video/source-channel document-affinity percentile + 0.25 title-form compatibility + 0.15 outlier proof, then deterministic packaging-similarity and source-channel diversification.
- The ranking/config/input artifacts were frozen before this reporting script loaded resolved judgments. The source-channel feature itself is disclosed as dev-informed, so even a gate pass is exploratory rather than confirmatory.

Artifacts: `docs/prd/semantic-eval-v4/programmatic/dev-inputs.json`, `ranking-config.json`, `rankings-dev.json`, and `selection.json`.
