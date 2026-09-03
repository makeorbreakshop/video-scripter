# Semantic layer v1 evaluation

Date: 2026-09-02 (ET)  
Status: **channel-search gate failed — SQL-seeded judgments remain provisional pending blind pooled adjudication**

## Exact commands

`npx tsx scripts/semantic/embed-videos.ts --since 30d --max-usd 2`  
`npx tsx scripts/semantic/embed-channels.ts --since 30d --max-usd 2`  
`npx tsx scripts/semantic/eval-semantic.ts`

The 30-day corpus was embedded after credits were added. Channel metrics below use the 40-query,
SQL-grounded seed set. They are suitable for the PRD's initial stop gate, but remain provisional
until the pooled lexical/semantic/hybrid candidates are blindly adjudicated.

## Environment and coverage

| Item | Result |
|---|---:|
| Qdrant server | 1.19.0 |
| Container image/digest | sha256:057ee3a8da769fe7310dd3537b4dc7583bf87a95ce8ac43c0af5a46bc580d1fc qdrant/qdrant@sha256:057ee3a8da769fe7310dd3537b4dc7583bf87a95ce8ac43c0af5a46bc580d1fc |
| SQL videos (rolling 30d) | 47,638 |
| Qdrant videos_v1 | 47,641 |
| SQL channels | 4,072 |
| Qdrant channels_v1 | 4,072 |
| Qdrant RAM | 349.5MiB / 3.814GiB |
| Qdrant storage | 317M |
| Latest videos_v1 snapshot | 12.12 MiB |
| Latest channels_v1 snapshot | 10.10 MiB |
| Actual OpenAI tokens | 1,511,991 |
| Actual OpenAI cost | $0.03023982 |

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
| Known item | semantic | 0.100 | 0.275 | — | candidate |
| Known item | hybrid | 0.260 | 1.000 | — | pass |
| Discovery | lexical | 0.110 | — | 0.156 | provisional SQL-seed baseline |
| Discovery | semantic | 0.200 | — | 0.197 | candidate |
| Discovery | hybrid | 0.220 | — | 0.206 | fail |
| Analogue | lexical | 0.020 | — | 0.048 | provisional SQL-seed baseline |
| Analogue | semantic | 0.120 | — | 0.105 | candidate |
| Analogue | hybrid | 0.140 | — | 0.108 | fail |

Request p95 on this 40-query run (not the required 200-request endpoint benchmark): lexical
686.5 ms; semantic
1147.4 ms; hybrid
1368.6 ms.

Pass/fail: known item **pass**; discovery **fail**; analogue
**fail**. The revised bar requires hybrid known-item MRR within 0.02 of lexical,
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

Actual cost is **$0.03023982**. Estimates are emitted by the mandatory local
`cl100k_base` cost gate before each embedding run. Initial stop decision: **continue — at least one semantic or hybrid discovery/analogue result beats trigram on the SQL seed**.
