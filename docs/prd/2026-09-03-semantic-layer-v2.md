# PRD: Semantic layer v2 — retrieve, route, rerank, transfer

Owner: Brandon Cullum. Implementer: Codex. Reviewer: Claude Code.
Status: revision 3, Phase 0 scoring backfill gate added. Date: 2026-09-03. Supersedes the open items of `2026-09-02-semantic-layer-v1.md`; v1 infrastructure (Qdrant, `videos_v1`, `channels_v1`, `embeddings_v1`, sync LaunchAgent, cost ledger) stays and is reused.

Revision 3 incorporates Codex's scoring-coverage audit and Phase 0 implementation. The 4,357 outlier count is a current-score coverage artifact, not a valid year-wide outlier universe until scores are backfilled or the experiment is narrowed to the scored recent window.

Research basis: `~/shared-memory/knowledge/projects/video-scripter/2026-09-03-sota-semantic-retrieval-research.md` (§4, §6, §9). v1 results: `docs/prd/2026-09-02-semantic-eval.md`, `docs/prd/2026-09-03-thumbnail-vector-eval.md`, and the assumption audit in shared-memory.

## 1. Why v2

v1 proved the plumbing (48,905 videos + 4,087 channels embedded for $0.23) and disproved the method: single-vector nearest neighbour plus RRF fails every usefulness bar (best 3.16/6, outlier lift 1.12×, topical outliers P@20 0.25, analogue nDCG 0.108). The failure is structural:

- Production systems are candidate generation → fusion → learned rerank → business rules. Single-vector NN is a demo.
- "Proven ideas from other niches" has a published recipe (purpose/mechanism split) that lifts precision from ~0.63 to ~0.92, and it is what our 2025 Idea Heist did.
- LLM enrichment is cheap at 2026 batch prices; the population that needs it is small (§6.2).
- The v1 gold set was seeded from the incumbent SQL search and judged in a fixed order, so it could not adjudicate anything.

v2 fixes the evaluation, then adds the missing stages in the order the evidence supports. Nothing is exposed until §8 gates pass.

## 2. Product jobs

| # | Job | Lane | Query shape |
|---|---|---|---|
| J1 | "Find channel X" (known item) | identity | short, lexical |
| J2 | "Channels like mine" | channel-similar | channel id |
| J3 | "Videos like this one" | video-similar | video id |
| J4 | "What is beating baseline in <topic>" | topical-outliers | free text |
| J5 | "Proven ideas from other niches that would transfer to my channel" | analogue | channel id (+ optional video id) |

v1 measured that one global fusion weight cannot serve J1 and J5 at once. That is the justification for intent routing (§5.1).

## 3. Live data facts (verified 2026-09-03)

| Fact | Value |
|---|---|
| Long-form videos published in last 365 days | about 167K |
| …with a `video_scores` row before Phase 0 | about 66K |
| …with a numeric score before Phase 0 | about 19.5K |
| …score ≥ 2 and confidence likely/confirmed before Phase 0 | about **4.35K** across about **1.7K** channels |
| `bertopic_clusters` rows | 1,108 = 892 (2025-07-11 run) + 216 (2025-08-03 run) |
| Centroid provenance columns | none (`cluster_id, topic_name, parent_topic, grandparent_topic, centroid_embedding, video_count, created_at, updated_at`) |
| `topic_niche` on videos in the 30-day window | null |

Consequences: the apparent outlier pool is heavily biased toward recently scored videos. Facet extraction and analogue evaluation must not treat the 365-day pool as representative until Phase 0 produces a versioned coverage manifest, or until the experiment is explicitly narrowed to the scored recent window. The centroids cannot be assumed to share a representation with `videos_v1` vectors.

## 4. Scope

In:
1. Phase 0 scoring backfill using direct Postgres only (§4.1).
2. Evaluation protocol, incremental (§5). Query sets and rubric are frozen first; systems join the pool as they are built.
3. BERTopic centroid audit and shadow topic assignment (§7.1).
4. Indexed full-text ranking over title + cleaned description (§6.2).
5. Fusion comparison: RRF, per-lane weighted RRF, DBSF, tuned linear (§6.2).
6. Intent routing with per-lane parameters (§6.1).
7. Local cross-encoder reranker experiments, title-only and enriched (§6.3).
8. Facet extraction pilot (200 items), then the outlier pool plus tracked-channel history (§7.2).
9. Named aspect vectors, job-specific channel medoids, analogue composite tuned on a dev split (§8).
10. Verification pass with backfill on the analogue lane only (§8.4).
11. Cheap controls: topic-centroid subtraction, Doc2Query in a separate collection (§7.3).

Out (v3 or never): GraphRAG; ColBERT as a primary index; contrastive fine-tuning (no interaction data yet; recipe in research §3 for later); a GPU box; full-corpus thumbnail backfill (thumbnail lane stays separate, never averaged with text); challenger embedding models.

## 4.1 Phase 0 scoring backfill gate

The semantic v2 enrichment depends on outlier status. Before using a 365-day outlier pool, run `scripts/semantic/backfill-scores.ts`:

1. Dry-run first: `npx tsx scripts/semantic/backfill-scores.ts --min-age-days 60`.
2. Check Supabase org usage before the full write. The job uses direct Postgres, but the org-level blast radius rule still applies.
3. Write in bounded batches only after the usage check: `npx tsx scripts/semantic/backfill-scores.ts --write --min-age-days 60 --batch-size 500`.
4. Use model version `v3.1-semantic-backfill-2026-09` and source params from `v3.0` unless a newly fitted parameter set is explicitly created.
5. Keep the checkpoint file under `tmp/semantic-score-backfill-state.json`; reruns resume unless `--force` is passed.
6. Acceptance: coverage by age band is reported before and after. The 61-180d and 181-365d bands must have numeric-score coverage comparable enough for the eval window, or the eval must be narrowed and labelled as recent-window only.
7. No facet extraction, analogue candidate generation, or 365-day outlier claims may run before this gate passes.

## 5. Evaluation protocol (incremental)

5.1 Freeze first, before any system is built:
- Query sets per job (below), stored as JSON under `docs/prd/semantic-eval-v2/queries/`, versioned, never regenerated by a retriever.
- Judging rubric per job, stored alongside.
- Judge configuration and calibration procedure.

5.2 Query sets, authored without running any system under test:
- J1: 60 channel names Brandon types from memory + 40 handle/URL variants. Truth is one canonical exact target per query. No judging needed.
- J2: 50 seed channels stratified by `topic_domain` (where present) and subscriber band. Truth: pooled judgment, "would a creator of the seed channel say these compete or overlap usefully" on 0–3.
- J3: 50 seed videos, same stratification. Truth: pooled judgment graded separately on topic (0–3), packaging (0–3), format (0–3). Report each.
- J4: 40 topic strings. First count corpus coverage; exclude topics with fewer than 20 outliers across fewer than 3 channels in the window and report the exclusions. Truth: on-topic / off-topic on the pool.
- J5: 30 seed channels. Truth: `creative_adaptation | direct_application | background | none` per candidate. Only `creative_adaptation` is a hit; `direct_application` reported as copying.

Same topic and subscriber band may generate *candidates* for J2/J3 pools. They are never truth.

5.3 Pooling, incremental:
1. Run the v1 systems (trigram SQL, dense, v1 hybrid) plus 20 stratified random items per query; pool top-100 each; judge.
2. Each new system (BM25, each fusion variant, each reranker, facet composite) is added to the pool when it exists; only newly introduced candidates are judged.
3. The final cross-system table is produced once all systems exist. Intermediate tables are labelled as partial.

5.4 Judging:
- Presentation order randomized per item; system identity hidden.
- LLM judge: two provider families (OpenAI + Gemini satisfies independence; Claude optional). Temperature 0. Graded per rubric.
- Calibration: Brandon labels ~120 items concentrated on J3, J4, J5 (about 40 each; J1 is deterministic, J2 gets a 20-item spot check). Agreement statistics: quadratic-weighted κ for the ordinal 0–3 jobs; Krippendorff's α (nominal) for the J5 typology; bootstrap 95% CIs on both. Gate: weighted κ ≥ 0.70 (J3, J4) and α ≥ 0.667 (J5), or the LLM judge is not used for that job and human-only numbers are reported on the subset.

5.5 Metrics: Recall@100 (candidate generation) and nDCG@20 (ranking) reported separately per job with bootstrap 95% CIs over queries; paired permutation test for deltas. A delta under 0.02 nDCG on these set sizes is reported as noise, not as a ranking.

5.6 Output: `docs/prd/semantic-eval-v2/*.json` is the record; `docs/prd/2026-09-XX-semantic-eval-v2.md` is generated from it and never hand-edited. Archive `2026-09-02-semantic-eval.md` as stale.

## 6. Retrieval pipeline

6.1 Intent routing. `lib/semantic/route.ts`: explicit `mode` wins; else id-only → J2/J3; short q matching a channel-name trigram ≥ 0.6 → J1; `/outliers?topic=` → J4; `/ideas` → J5. Per-lane parameters (sources, fusion method, weights, thresholds) live in `score_params.params.semantic_v2.lanes`.

6.2 Candidate generation and fusion:
- Sources: full-text ranking over `title + cleaned description` (`tsvector` + `ts_rank_cd`, or ParadeDB `pg_search` if it installs cleanly and is explicitly recorded), dense `videos_v1`/`channels_v1`, and for J4/J5 a payload-filtered dense query (`is_outlier = true`, `published_at` range).
- Fusion is an experiment, not a decision. Rows in the eval: plain RRF (k per Qdrant guidance, tune on dev split), per-lane weighted RRF, DBSF, and a linear combination of min-max scores tuned on a dev split of the judged queries (held-out split reported). The eval picks per lane.
- Output: top 50 with per-source scores kept on the object for the reranker and for API evidence.

6.3 Reranker experiments. `lib/semantic/rerank.ts`, ONNX Runtime int8, budget top-50 under 300 ms on the Mac (measure and record):
- Baseline: `cross-encoder/ms-marco-MiniLM-L6-v2`, pair text `query ⟂ title | channel_name`.
- Enriched: `jina-reranker-v2-base-multilingual` or `mxbai-rerank-base-v2`, pair text = lane intent phrase + title + cleaned description (first 300 chars, links/affiliate boilerplate stripped) + channel + facets when present.
- Query text for id-based lanes: J3 uses the seed video's title + cleaned description (+ facets when present); J2 uses the seed channel's medoid titles joined.
- Gate: beats the chosen fusion order on nDCG@20 with a CI excluding zero for J3 and J4, else off. Off-the-shelf cross-encoders have been measured to hurt out of domain; expect the title-only baseline to fail and the enriched variant to be the real test.

## 7. Document enrichment

7.1 Centroid audit, then shadow assignment (no canonical writes):
1. Isolate the 216 rows from 2025-08-03. Recover their document recipe from the historical notes (30% title / 70% summary is the recorded blend) and their embedding model; if either cannot be established from code or notes, the centroids are treated as unproven.
2. For the 892 July rows, record hierarchy quality (`niche_-1`, `domain_-1` placeholders) and the 694 clusters with fewer than 5 sources; they are excluded from assignment.
3. Assign the nearest of the 216 to a judged sample of 300 recent videos and measure accuracy against Brandon/LLM topic labels. The cosine threshold is chosen on that sample, not preset.
4. Write to a shadow table `video_topic_assignments_v2 (video_id, cluster_id, cosine, method, assigned_at)`. `videos.topic_*` is not overwritten until accuracy is measured and accepted.
5. If provenance cannot be proven or accuracy is poor, rebuild topics: cluster `videos_v1` vectors (HDBSCAN or k-means at ~300–500 clusters over the 30-day window), label clusters with c-TF-IDF keywords plus an LLM label (about $0.10), version them as `topic_clusters_v2` with model, recipe and dims recorded.

7.2 Facet extraction. `scripts/semantic/extract-facets.ts`:
- Pilot: 200 items from the outlier pool, OpenAI cheapest tier. Brandon reviews 40. Proceed only if he accepts the pilot.
- Population after pilot: the Phase 0 versioned scored outliers in the accepted window plus recent history (last 50 long-form videos) for every tracked/user-lane channel. Extend only after measuring purpose/topic coverage gaps per J5 seed.
- Model: cheapest tier that passes the pilot (`gpt-5-nano` first, then `gemini-2.5-flash-lite`, then Haiku 4.5). Batch API, prompt cached, v1 cost gate (`--max-usd` default $10 for this job).
- Input per video: title, channel name, cleaned description (links, affiliate disclosures, boilerplate stripped), topic label if any. **Do not include score, baseline or view counts**; selection already implies outlier status and performance must not bias the semantic representation.
- Output schema (terse, ≤ 80 output tokens, `null`/`unknown` permitted):
  ```json
  {
    "niche": "laser engraving",
    "purpose": "prove a cheap tool matches an expensive one",
    "purpose_abstract": "underdog beats incumbent on a measurable task",
    "mechanism": "side-by-side test with a price reveal",
    "mechanism_abstract": "head-to-head comparison with a stake",
    "packaging_claim": "claims comparable quality at lower price",
    "evidence_status": "packaging_only",
    "hook_device": "price_reveal",
    "format": "comparison",
    "confidence": "medium"
  }
  ```
  The `*_abstract` fields are mandatory (the abstraction step in the analogy literature; without it extraction yields surface matches). `packaging_claim` is what the title/description promises; it is never presented as verified content. `evidence_status` is always `packaging_only` in v2.
- Storage: `video_facets (video_id, model, prompt_version, source_hash, facets jsonb, confidence, retry_count, extracted_at)`. Re-extract on source_hash change.
- Embed `purpose_abstract`, `mechanism_abstract`, `niche` separately (`text-embedding-3-small`, 512-d).

7.3 Cheap controls, in parallel with 7.2:
- Topic-centroid subtraction (`v' = v − proj(v, c_topic)`) or LEACE, stored as named vector `detopic`. Only meaningful once 7.1 yields trusted topics.
- Doc2Query: 3 short queries per video for the 30-day window (~$3), indexed in a separate collection `queries_v2` pointing to `video_id`. Never appended to the title vector.

## 8. Aspect vectors and the analogue lane

8.1 Qdrant: new collection `videos_v2` with named vectors `title`, `purpose`, `mechanism`, `niche`, `detopic`; `hnsw_config.m = 0` on vectors used only for rescoring; v1 payload indexes carried over. Migration documented.

8.2 Channel medoids, job-specific. `build-channel-prototypes.ts` (rewrite):
- Topic medoids (J2): Ward clustering over `title` vectors, last 90 days or last 50 videos, α tuned on the J2 dev split, cap 8, medoid per cluster, recency-weighted importance `Σ e^(−λΔt)`, λ initial 0.01/day, tuned.
- Purpose medoids (J5): same procedure over `purpose` vectors, for channels with facets.
- Stored as `channel_prototypes (channel_id, kind, video_id, importance, cluster_size, built_at)`. J2 queries the 3 highest-importance topic medoids, merges round-robin with dedup; the `channels_v1` mean vector stays as an eval baseline row.

8.3 Analogue retrieval (J5), structure fixed, constants tuned:
1. Candidate generation: for each purpose medoid of the seed, top-200 by `purpose` cosine, filtered to outliers in window. Union. Report pool size per seed; below 30 is "insufficient coverage" and is returned truthfully.
2. Features per candidate: purpose similarity, niche similarity to seed, mechanism similarity to the nearest seed video, log(score), recency.
3. Composite: linear combination with a **partial-match** shaping on purpose (penalise above a cap). All weights, the cap and the niche/mechanism cut-offs are parameters in `score_params` tuned on the J5 dev split and reported with the held-out result. Revision 1's constants (60th/80th percentile, 0.85 cap) are starting values only.
4. Diversify: MAX-MIN dispersion on `mechanism` over the top 30.
5. Evidence per hit: the seed medoid it matched, purpose/mechanism strings, niche distance, score. No bare cosine percentages.

8.4 Verification pass (J5 only), with backfill:
- Send the top 30 with the seed summary to an LLM; per candidate return `{ verdict: creative_adaptation|direct_application|background|none, mapping }`.
- Accept `creative_adaptation`; walk down until 10 accepted or the pool is exhausted; report the shortfall.
- Generate the two diversified transfer suggestions **only for accepted candidates**, in a second call, so the model cannot rationalise a weak match with an attractive transfer.
- Budget 4 s and under $0.02 per query; every call logged to `semantic_cost_ledger`.

## 9. Gates (measured by §5, held-out split)

| Job | Metric | v1 | Gate |
|---|---|---|---|
| J1 | MRR | ~0.80 | ≥ 0.85, no regression vs trigram |
| J2 | nDCG@20 vs pooled judgment | not measured cleanly | ≥ 0.55 |
| J3 | nDCG@20 (topic), packaging and format reported | — | ≥ 0.50 topic |
| J4 | P@20 on-topic outliers | 0.25 | ≥ 0.60 with trusted topics; ≥ 0.70 with facets |
| J5 | creative_adaptation share of returned | 0.108 nDCG binary | ≥ 0.40 with direct_application ≤ 0.20 |
| Reranker | Δ nDCG@20 over chosen fusion, J3 + J4 | — | > 0, CI excludes zero, else off |
| Judge | weighted κ (J3, J4) / α (J5) vs Brandon | — | ≥ 0.70 / ≥ 0.667 |

No v2 route is exposed, even behind a flag, until J1, J4 and J5 pass on the held-out split. All v2 endpoints stay local until then.

## 10. Cost and infra

- Facets: pilot under $0.20; outlier pool + tracked history under $2; Doc2Query ~$3; topic relabel ~$0.10; verification under $0.02/query. Hard cap $25 for this PRD without asking Brandon.
- Compute: everything on the Mac; reranker via ONNX on CPU; `videos_v2` with five 512-d named vectors on ~60K videos is under 1 GB.
- No new services beyond v1. The hourly LaunchAgent gains facet extraction and shadow topic assignment for new outliers.

## 11. Work order

Phase 0, factual repair (days 1–2): run the scoring backfill gate (§4.1) or narrow the eval window truthfully; schemas (`video_topic_assignments_v2`, `video_facets`, `channel_prototypes`, `queries_v2`, `videos_v2`), idempotent; centroid audit (§7.1 steps 1–2); freeze query sets and rubrics; commit the uncommitted `eval-semantic.ts` work or discard it.
Phase 1, evaluation and cheap baselines (week 1): pooled incremental eval with v1 rows; Brandon's calibration session; BM25 index; fusion comparison; title-only and enriched reranker rows; shadow topic assignment accuracy.
Phase 2, enrichment (week 2): facet pilot → Brandon review → outlier pool + tracked history; controls (§7.3); J4 re-measured.
Phase 3, analogue (week 3): `videos_v2`, purpose/topic medoids, composite tuned on dev split, verification with backfill; J2/J3/J5 measured on held-out.
Phase 4, exposure decision: only after gates pass, commit endpoint changes locally, verify, leave for Brandon's review.

## 12. Rules for the implementer

- Direct Postgres via `pg` only; never the Supabase JS client. Batch reads ≤ 5,000 ids, indexed predicates, statement timeout respected.
- Every LLM/embedding call goes through the cost gate and the ledger; print the day's total at the end of each run.
- **Commit locally as you go. Never push.** Brandon reviews and pushes.
- No v2 route is reachable from the deployed app or exposed behind flags before §9 passes.
- Report failures as failures. A gate that does not pass is a result; do not loosen the gate.
- Eval markdown is generated from JSON; regenerate, do not edit.
- Log each session to `~/shared-memory/memory/YYYY-MM-DD.md`; update `PROJECTS.md` when status changes.

## 13. Decisions taken from Codex's review

1. Facet population: Phase 0 versioned scored outliers in the accepted window plus recent history for tracked channels. Not 47K arbitrary recent videos, and not an unbackfilled 365-day pool.
2. Brandon's labelling session: yes, ~120 items focused on J3, J4, J5.
3. Foreplay and Motion: one hour of review before the facet vocabulary is frozen, to learn how working creative teams name hooks, concepts and formats. Not to copy architecture. Output: a short note in `docs/prd/semantic-eval-v2/creative-vocab.md` and any additions to the `hook_device`/`format` enums.
