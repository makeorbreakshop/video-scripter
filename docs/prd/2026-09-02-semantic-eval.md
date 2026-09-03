# Semantic layer v1 evaluation

Date: 2026-09-02 (ET)  
Status: **blocked — OpenAI account has no credits; collections are empty**

## Exact commands

`npx tsx scripts/semantic/embed-videos.ts --since 30d --max-usd 2`  
`npx tsx scripts/semantic/embed-channels.ts --since 30d --max-usd 2`  
`npx tsx scripts/semantic/eval-semantic.ts`

The first live embedding call returned OpenAI `429: no credits remaining`. No embeddings were
created and no cost was incurred. The SQL-grounded gold seed is present, but semantic, hybrid,
similar-video, topical-precision, exact-recall, latency, and agent-task conclusions would be
fabricated until vectors exist and blind judgments are completed.

## Environment and coverage

| Item | Result |
|---|---:|
| Qdrant server | 1.19.0 |
| Container image/digest | sha256:057ee3a8da769fe7310dd3537b4dc7583bf87a95ce8ac43c0af5a46bc580d1fc qdrant/qdrant@sha256:057ee3a8da769fe7310dd3537b4dc7583bf87a95ce8ac43c0af5a46bc580d1fc |
| SQL videos (rolling 30d) | 47,510 |
| Qdrant videos_v1 | 0 |
| SQL channels | 4,069 |
| Qdrant channels_v1 | 0 |
| Qdrant RAM | 22.62MiB / 3.814GiB |
| Qdrant storage | 22M |
| Latest videos_v1 snapshot | 12.12 MiB (empty collection; not representative) |
| Latest channels_v1 snapshot | 10.10 MiB (empty collection; not representative) |
| Actual OpenAI tokens | 0 |
| Actual OpenAI cost | $0.00000000 |

Full dry-run cost gates (local tokenization, no OpenAI request):

| Entity | Documents | Tokens | Estimated cost | Wall time |
|---|---:|---:|---:|---:|
| Videos | 47,502 | 1,092,170 | $0.02184340 | 17.3 s |
| Channels | 4,069 | 415,639 | $0.00831278 | 5.5 s |
| Total | 51,571 | 1,507,809 | $0.03015618 | 22.8 s |

## 6.1 Channel search

| Stratum | Mode | Recall@10 | MRR | NDCG@10 | Result |
|---|---|---:|---:|---:|---|
| Known item | lexical | 0.240 | 1.000 | — | baseline |
| Known item | semantic | blocked | blocked | — | no vectors |
| Known item | hybrid | blocked | blocked | — | no vectors |
| Discovery | lexical | 0.110 | — | 0.156 | provisional SQL-seed baseline |
| Discovery | semantic | blocked | — | blocked | no vectors |
| Discovery | hybrid | blocked | — | blocked | no vectors |
| Analogue | lexical | 0.020 | — | 0.048 | provisional SQL-seed baseline |
| Analogue | semantic | blocked | — | blocked | no vectors |
| Analogue | hybrid | blocked | — | blocked | no vectors |

Lexical request latency on this 40-query run (not the required 200-request endpoint benchmark):
known item p95 502.4 ms; discovery p95 150.6 ms;
analogue p95 157.1 ms.

Pass/fail: **blocked**. The revised bar requires hybrid known-item MRR within 0.02 of lexical,
discovery/analogue NDCG at least +0.10, and recall improvement.

## 6.2 Similar videos

| Metric | Result | Bar |
|---|---:|---:|
| Mean blind pair grade | blocked | ≥4/6 |
| Lists with ≥5 unique channels | blocked | ≥80% |
| Neighbour outlier-rate lift | blocked | ≥2× |
| Median cosine similarity | blocked | descriptive only |

## 6.3 Topic outliers

| Metric | Result | Bar |
|---|---:|---:|
| Precision@20 across 15 topics | blocked | ≥0.80 |

## 6.4 Agent tasks

| Metric | Result | Bar |
|---|---:|---:|
| Tasks successful in ≤3 calls | blocked | ≥10/12 |
| Degraded runs detected | HTTP contract verified; eval blocked | 100% |
| Match evidence sufficient | blocked | recorded per task |

## Qdrant retrieval and operations

| Metric | Result | Bar |
|---|---:|---:|
| Approximate top-10 recall vs exact (100 queries) | blocked | ≥0.95 |
| Endpoint p95 over 200 requests | blocked | report only |
| Snapshot size | videos 12.12 MiB; channels 10.10 MiB (empty/unrepresentative) | report only |

## Method experiments

| Experiment | Variants | Winner | Reason |
|---|---|---|---|
| A. Video document | title; title+channel+niche; title+description | not evaluated | no embeddings |
| B. Dimensions | 512; 1536 | not evaluated | no embeddings |
| C. Channel document | titles; titles+niches; mean video vectors | not evaluated | no embeddings |
| D. Query strategy | raw; hybrid RRF; multi-query; creator prefix | not evaluated | no embeddings |
| E. Similarity floor | none; 0.35; 0.5 | not evaluated | cosine remains uncalibrated |
| F. Channel representation | aggregate; intent vectors; mean+lexical | not evaluated | no embeddings |

Winning variant A: **not determined**.  
Winning variant D: **not determined**.

## Cost and stop decision

Actual cost is **$0.00000000**. Estimates are emitted by the mandatory local
`cl100k_base` cost gate before each embedding run. The PRD stop rule cannot yet be evaluated:
semantic/hybrid retrieval has not run, so this report makes no claim that it beats trigram.
