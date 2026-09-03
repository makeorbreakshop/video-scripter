# PRD: Semantic layer v2 — trustworthy retrieval before enrichment

Owner: Brandon Cullum. Implementer: Codex. Reviewer: independent fresh-context agent.
Status: revision 5 programmatic cross-topic packaging experiment completed and stopped after failing the fixed gate. Date: 2026-09-03.
Supersedes revisions 1–3 and the open quality claims in `2026-09-02-semantic-layer-v1.md`. The v1 infrastructure remains the control; no semantic endpoint is promoted or expanded until the held-out gate in this PRD passes.

Revision 4 resets the project after the 5.6 Sol audit. The previous v1 gold set, v2 query manifest, 204-row facet pilot, `videos_v2` pilot vectors, and derived channel prototypes are quarantined from evaluation. They may remain as historical artifacts but cannot supply truth, tune parameters, or justify a product claim.

Research context: `~/shared-memory/knowledge/projects/video-scripter/2026-09-03-sota-semantic-retrieval-research.md` and `~/shared-memory/knowledge/projects/video-scripter/2026-09-03-semantic-sol-reaudit.md`.

## 1. Outcome

Establish whether ChannelSmith can retrieve useful videos and channels from the existing metadata—without transcripts—using a small, representative, blind evaluation.

The first deliverable is one end-to-end vertical slice:

1. a fixed set of 12–20 real product tasks;
2. a versioned, quality-guarded one-year outlier corpus;
3. lexical and OpenAI dense candidate retrieval over title plus cleaned description;
4. a blind pooled judgment record;
5. held-out ranking and coverage results that determine the next engineering step.

The goal is evidence about retrieval quality, not completion of a predetermined architecture.

## 2. Non-goals and protected behavior

- No transcripts, new summaries, GraphRAG, ColBERT primary index, embedding-provider bake-off, fine-tuning, GPU service, Pinecone, or full-corpus thumbnail backfill.
- No corpus-wide facet extraction, BERTopic rewrite, named-vector expansion, channel clustering, reranker, or Doc2Query until the vertical slice identifies that specific need.
- No v2 endpoint exposure. Existing `/api/v1` behavior and Qdrant-down lexical fallback remain unchanged.
- No Supabase JS or REST for bulk work. Use direct Postgres through `DATABASE_URL` and `pg`, batches of at most 5,000 ids, indexed predicates, and the 45-second statement timeout.
- No claim that an LLM-generated label is ground truth. Labels are bounded relevance judgments with provenance.
- No push, deployment, or production migration.

## 3. Prior learnings

### 3.1 What remains valid

- Local Qdrant, OpenAI 512-dimensional embeddings, direct-Postgres sync, cost logging, and degraded lexical fallback work.
- The score backfill produced versioned mature-window coverage and is reusable.
- Title-only dense similarity is an inexpensive control but did not show useful product quality.
- The 498-item thumbnail pilot shows enough visual signal to retain as an optional visual-intent retriever; it does not yet prove product quality.
- Query embeddings must be frozen for replayable evaluation. Regenerating the same OpenAI query embeddings produced small floating-point differences that changed close-neighbor ranks; revision-4 candidate recipe 2 snapshots those vectors and records their hash.

### 3.2 What is retired from evaluation

- v1 channel truth was partly produced by SQL substring search and contains false positives.
- The revision-3 J2/J3/J5 seeds selected the missing-metadata tail; the J4 “zero coverage” result measured exact equality against empty topic columns, not semantic corpus coverage.
- The 204 facet rows were sampled from raw score ratios. Only 19 met the live endpoint’s baseline safeguards, and inspected output included a semantic hallucination.
- The stored channel prototypes came from a greedy threshold selector, not Ward clustering or true medoids.
- `detopic` is a title-vector placeholder.

These are negative findings and scaffolding, not inputs to the new scorecard.

## 4. Canonical data contracts

The library contains about 901K videos. The vertical slice deliberately uses the smaller rolling one-year long-form population and does not describe it as the whole library.

The video candidate universe serves J3, J4, and J5. A video must satisfy all of the following:

- published in the rolling last 365 days;
- not a Short and not zero-duration;
- non-empty title;
- `coalesce(videos.is_institutional, false) = false`; `videos.is_institutional` is authoritative for this experiment and null means not marked institutional, matching the current application guard;
- a `video_scores` row with `score >= 2` and confidence `likely` or `confirmed`;
- `n_baseline >= 5` and `baseline >= 5000`;
- the score row was computed no later than the frozen `as_of` timestamp;
- stable `video_id` and `channel_id`.

The frozen September 3 manifest contains 9,385 videos across 1,498 channels. The build must record the exact SQL predicate, score-model versions, row count, distinct-channel count, time boundary, source hashes, and creation time in the corpus manifest. It must not silently substitute the raw ~25.8K `score >= 2` population.

Its retrieval document is exactly:

```text
title: <title>
channel: <channel name>
description: <cleaned description, with links, affiliate disclosures, and repeated boilerplate removed>
```

Performance fields stay in payloads for filtering/evidence and are not embedded.

The channel candidate universe serves J1 and J2. It is the frozen intersection of channel ids present in `channel_directory`, `channel_meta`, and `channels_v1` at `as_of`. Every selected channel must have a non-empty name, non-null subscriber count, and at least five eligible long-form videos in the 365-day window. J1 targets must be present in this universe. The channel document is the channel name plus its 20 most-viewed eligible titles in the frozen 365-day window and any available topic/niche strings; its exact hash is recorded. J1 lexical search uses name/handle fields but is filtered to the same frozen ids; J2 lexical ranking and dense ranking use the same channel documents. No video-to-channel aggregation is performed at query time.

The two entity universes are intentionally different because known-channel retrieval and outlier-video retrieval are different product jobs. Comparisons are valid within a lane; metrics are never averaged across channel and video entities into one headline score.

## 5. Product tasks and split

Freeze 16 tasks before running any retriever:

| Lane | Count | Task form | Judgment |
|---|---:|---|---|
| J1 known channel | 2 | exact name/handle | canonical channel id |
| J2 similar channel | 3 | “find channels useful to a creator like this channel” | 0–3 useful overlap |
| J3 similar video | 3 | “find videos similar in topic or packaging to this seed” | topic and packaging scored separately, 0–3 |
| J4 topical outliers | 4 | “find current outliers about this subject” | binary on-topic plus valid-outlier check |
| J5 cross-niche inspiration | 4 | “find proven ideas whose framing could transfer to this creator” | `creative_adaptation`, `direct_application`, `background`, or `none` |

Task language is authored from the product job, user/tracked channels, and recognizable creator workflows—not from any system’s search results. IDs may be resolved through exact indexed database lookups after the task is written. Seeds must be non-institutional, have usable titles/channel identity, and avoid the missing-metadata tail.

The manifest explicitly assigns eight tasks to `dev` and eight to `heldout`, balanced across the lanes as far as the small sample allows. System selection and any weights use `dev` only. Baseline configurations are frozen, then `heldout` is run once for the decision report. Any challenger authorized by that report requires a new frozen confirmation set; the original held-out tasks may be used only as diagnostic development evidence after they are opened.

## 6. Candidate systems

Every system in a lane searches the same versioned entity universe and returns up to 100 unique candidates with stable ids, ranks, raw scores, document hashes, and latency.

1. `lexical_bm25`: local BM25-style ranking over the lane’s documents. J1 also searches name/handle and receives an explicit exact-match boost.
2. `openai_dense`: `text-embedding-3-small`, 512 dimensions, cosine distance over the lane’s recorded document recipe.
3. `rrf_control`: unweighted reciprocal-rank fusion of the first two systems. It is a control, not an assumed winner.
4. `thumbnail_visual` only for a task explicitly marked visual and only when its seed/corpus coverage is reported. It never enters a nonvisual task silently.

The initial slice does not add a reranker. It first determines whether failure is candidate generation or ordering.

## 7. Blind pooled evaluation

For each task, union all systems’ top 100, deduplicate by stable id, and randomize with a fixed seed. The judging view must omit system identity, system rank, score, outlier ratio, and popularity signals. It includes only the task/seed and candidate title, channel, cleaned description, thumbnail when the lane requires it, and stable blind id.

Codex performs the bulk rubric judgments in two independently shuffled passes. A disagreement triggers a third shuffled adjudication pass. Ordinal J2/J3 labels use the median of the three scores; binary J4 uses majority vote. J5 uses a category only when at least two passes agree; otherwise it remains `unresolved`. Brandon receives a 15–20-item packet containing all unresolved top-10 items first, then a fixed-seed sample of other disagreements and decision-boundary cases. This spot check calibrates “useful transfer” and is not a request to label the corpus.

J5 metrics are reported as lower/upper sensitivity bounds when unresolved labels remain: unresolved is non-relevant in the lower bound and relevant in the upper bound. No J5 winner or gate pass may be claimed if unresolved top-10 labels remain or the gate conclusion differs between bounds.

Judgment files record rubric version, judge/model identity, input hash, output, confidence, and timestamp. A candidate introduced by another system is judged once per pass and reused across comparisons.

Report separately:

- pooled relevant coverage at 100 for each system (recall relative to the judged union, explicitly named as pooled recall);
- nDCG@20 and precision@10;
- J3 topic and packaging scores separately;
- J4 invalid-outlier rate;
- J5 creative-adaptation precision and direct-application/copying rate;
- p50/p95 latency and zero-result rate;
- bootstrap 95% confidence intervals over tasks, labeled descriptive because the sample is small.

No metric may treat unjudged candidates as relevant. The report includes pool depth and overlap so incompleteness is visible.

## 8. Decision tree

The held-out result diagnoses and selects the next experiment; it does not evaluate that challenger:

1. If no system surfaces useful candidates in the top 100, stop ranking work. Improve document cleaning/recipe, query expansion, or add a new retriever on a bounded cohort.
2. If useful candidates are in the pool but below the top 20, develop one local cross-encoder on the original dev tasks, freeze it, and evaluate it on a new confirmation set. Keep it only if confirmation nDCG improves with no unacceptable latency increase.
3. If J5 candidates are topically plausible but not transferable, dynamically extract purpose/mechanism for the seed and pooled candidates, then have an LLM verify the mapping. Develop on the original dev tasks and precompute facets only if the challenger wins on a new confirmation set.
4. If channel results collapse multiple real modes into an average, then test multiple representative prototypes. Implement true clustering/medoids only against this observed failure.
5. If visual tasks fail in text but thumbnail candidates work, expand the thumbnail cohort separately.

BERTopic assignment, de-topic vectors, Doc2Query, provider bake-offs, and corpus-wide enrichment remain parked until a measured failure maps to them.

## 9. Acceptance contract

### Corpus and integrity

- Each entity manifest contains only rows satisfying §4 and includes exact reproducibility metadata.
- A test rejects low-baseline, insufficient-baseline, institutional, Short, zero-duration, missing-id, and out-of-window rows.
- Bulk reads use direct `pg`; an egress guard rejects Supabase clients/REST in semantic scripts.

### Evaluation

- Exactly 16 tasks are frozen before retrieval and include a fixed dev/held-out assignment.
- A validation test rejects missing seed metadata, duplicate ids, unsupported lanes, missing rubrics, or a changed manifest hash.
- Blind pool artifacts cannot reveal source system, ranks, scores, or performance metadata to the judge.
- Candidate runs are reproducible from the applicable entity-universe and task manifests.
- Generated reports distinguish pooled recall from exhaustive recall and dev from held-out.

### Continue/stop gate

The project may proceed to one conditional challenger only if the held-out data identifies a specific failure from §8. The challenger must be evaluated on a newly frozen confirmation set. A production-route proposal requires all of the following on that untouched confirmation set:

- J1 MRR does not regress more than 0.02 from lexical;
- J4 precision@10 is at least 0.60 with zero invalid-outlier results;
- J5 creative-adaptation precision@10 is at least 0.30 and direct-application rate is at most 0.20;
- the chosen semantic/hybrid system improves confirmation-set nDCG@20 by at least 0.05 over lexical on at least one non-J1 lane without a material regression on the others measured on that same confirmation set;
- Brandon’s spot check exposes no rubric-level mismatch that invalidates the bulk judgments.

Failure is a valid result. Do not weaken a gate to continue.

## 10. Work units

- [x] Complete the versioned score backfill and verify direct-Postgres operation.
- [x] Establish the v1 OpenAI/Qdrant control, local thumbnail pilot, cost ledger, sync, and Qdrant-down fallback.
- [x] Re-audit v1/v2 evidence and quarantine invalid truth/prototype artifacts.
- [x] Add pure corpus-eligibility, task-manifest, blind-payload, pooling, and metric tests; confirm they fail against the old behavior.
- [x] Build and freeze the 16-task manifest plus the guarded video and channel-universe manifests without running retrieval.
- [x] Materialize the bounded retrieval documents and OpenAI vectors with a maximum initial-slice budget of $2 (9,385 videos and 3,544 channels reconciled in Qdrant; estimated clean-run cost $0.06083).
- [x] Run lexical, dense, and RRF candidate generation; write immutable run artifacts (all 48 task/system rankings reproduced exactly after freezing query vectors).
- [x] Produce two-pass blind Codex judgments and the 15–20-item Brandon spot-check packet (2,196 pooled non-J1 candidates; 841 third-pass adjudications; 20-item packet).
- [x] Generate the dev and held-out report with uncertainty, latency, coverage, quality, total cost, and the §8 next-step decision.
- [x] Independently review the artifacts against this PRD. Do not expose endpoints.

## 11. Verification handoff

Required deterministic checks:

```bash
npx jest lib/semantic --runInBand
npx tsc --noEmit
```

Required real-path evidence:

- direct-Postgres corpus build completes under the 45-second statement timeout with no REST traffic;
- exact corpus counts independently reconcile to the manifest;
- Qdrant-down behavior remains lexical and reports degradation;
- rerunning candidate generation with unchanged manifests produces identical ids/ranks, apart from recorded latency;
- a fresh-context reviewer can regenerate the report from JSON without hand editing it.

## 12. Risks, rollback, and budgets

- The one-year boundary moves with time. Every run freezes its `as_of` timestamp and uses it for all SQL predicates.
- Pooled judgments are incomplete truth. The report must call them pooled recall and show random/novel-candidate coverage; it cannot claim exhaustive recall.
- Codex self-judging can be biased. Two shuffled passes, disagreement surfacing, and Brandon’s small spot check are required before a product claim.
- The initial evaluation may be underpowered. Confidence intervals remain visible; a small apparent delta is not a win.
- New artifacts use versioned collection/file names and can be deleted without affecting `videos_v1`, `channels_v1`, or existing APIs.
- Initial-slice OpenAI hard cap: $2. Total revision-4 hard cap: $5 without asking Brandon.
- Never print secrets. Never push.

## 13. Immediate execution boundary

Begin with the first unchecked work unit and proceed serially through the frozen manifests and candidate run. Stop before bulk LLM judging only if the blind pool cannot be proven clean or the cost gate would be exceeded. Stop all endpoint work until §9 passes.

## 14. Revision-4 vertical-slice result

The frozen diagnostic evaluation is recorded in `2026-09-03-semantic-eval-v4.md` and the machine-readable artifacts under `semantic-eval-v4/`.

- Known-channel search remains lexical: held-out J1 MRR was 1.000 lexical, 0.125 dense, and 0.333 RRF.
- OpenAI dense retrieval is useful for similarity: held-out J3 topic precision@10 was 1.000 and topic nDCG@20 was 0.681.
- Topical outlier search does not pass the production bar: held-out J4 precision@10 peaked at 0.350 for RRF versus the 0.600 bar.
- Cross-niche inspiration fails under all three controls: held-out lower-bound creative-adaptation precision@10 was 0.100 lexical, 0.000 dense, and 0.050 RRF; direct-application rates were 0.750, 1.000, and 0.900.

The diagnostic result triggers both §8.2 and §8.3. On the J5 maker dev task, lexical retrieved 20 judged creative adaptations with the first at rank 44 and RRF retrieved 9 with the first at rank 66; dense retrieved none. On the J5 tech dev task, lexical retrieved 14 with the first at rank 27 and RRF retrieved 7 with the first at rank 50; dense retrieved none. Every system's top 10 on both tasks was direct application. Useful candidates therefore exist in the pool but rank too low, while the top results are topically plausible but do not transfer.

The single next experiment is a J5-local reranking bake-off on the original dev pools. Variant A is a simple local cross-encoder control. Variant B dynamically extracts purpose/mechanism for the seed and pooled candidates and requires an explicit transfer mapping. Select one variant using dev only, freeze it, and evaluate only that selected variant on a newly frozen confirmation set. Do not precompute corpus-wide facets, add a corpus-wide reranker, or expose endpoints. The current diagnostic set cannot approve a production route, and Brandon's blinded calibration packet remains required before any product claim.

## 15. J5 challenger result

The bounded bake-off is recorded in `2026-09-03-semantic-j5-challenger.md` and `semantic-eval-v4/challenger/`. Both variants reranked only the two original frozen J5 dev pools; neither reranker received held-out tasks or performance metadata.

| Variant | Lower creative P@10 | Upper creative P@10 | Lower nDCG@20 | Direct application@10 | Hit both tasks | Unresolved top 10 | Gate |
| --- | ---: | ---: | ---: | ---: | --- | ---: | --- |
| Local MS-MARCO cross-encoder | 0.200 | 0.250 | 0.184 | 0.700 | yes | 1 | fail |
| Purpose/mechanism + explicit transfer verification | 0.150 | 0.150 | 0.161 | 0.850 | yes | 0 | fail |

Neither variant met the required 0.300 lower-bound precision, 0.200 maximum direct-application rate, per-task creative-hit, and zero-unresolved gates. No variant is selected, so there is no confirmation run, corpus-wide facet extraction, endpoint work, or deployment. This is the PRD stop condition: metadata-only retrieval supplies some useful candidates, but these two reranking methods do not separate creative transfer from direct copying reliably enough.

The first challenger artifacts were withdrawn after independent review found that 101 of 312 model documents differed from the blind judgment text and that the cross-encoder envelope hash was invalid. The final run rebuilds candidates from the exact blind title/channel/description fields, validates both judgment-pass hashes for every candidate, binds the resolved-label and source-artifact hashes, recomputes rankings and metrics in the report generator, and records the provider-returned model name. The primary purpose/mechanism pass emitted 38 internally inconsistent creative labels. Its single repair pass produced 37 valid decisions; one remained invalid, was deterministically demoted to the bottom, and did not enter either task's top 20.

Total semantic spend through the stop is conservatively bounded at $0.898715: $0.367486 from the frozen prior ledger plus $0.531229 for all challenger attempts. The challenger bound deliberately charges the interrupted corrected-input attempt the entire unused portion of its original $0.50 cap because its transfer-call usage was not persisted.

The original v1 §10 experiment A (video document recipe) and D (query strategy) still have no valid winner. Revision 4 invalidated the old provisional comparison and did not authorize those bake-offs; this J5 result is not an A or D win.

## 16. Revision-5 programmatic cross-topic packaging experiment

Revision 4 proved that useful J5 candidates exist in the pooled top 100 but that ordinary semantic relevance and the first metadata-only LLM verifier rank direct copies above creative adaptations. The next bounded experiment therefore removes generative inference from the retrieval service. It tests whether deterministic packaging-form features, frozen document-affinity novelty, trustworthy outlier evidence, and source diversity can rank transferable source videos. A caller-owned skill may interpret the returned evidence later, but that interpretation is not part of retrieval or this evaluation.

### 16.1 Outcome and protected behavior

Build one offline, replayable reranker over only the two frozen J5 dev pools. It must make no OpenAI generation call, no embedding call, no database write, and no endpoint change. It may read the frozen task, pool, judgment, query-vector, and candidate-run artifacts plus the exact frozen Qdrant payload/vector for those candidate ids and seed channels. It must not use the resolved labels, source-system ranks, or source-system scores while constructing features or rankings; those are evaluator-only inputs after rankings are frozen.

The programmatic representation is deliberately multi-part:

- deterministic title-form features such as comparison, test, challenge, transformation, list, price, time constraint, warning, verdict, novelty, question, first-person, and superlative framing;
- a normalized title skeleton that masks amounts, counts, durations, years, percentages, and content-bearing subject spans while preserving packaging operators;
- target-channel format compatibility computed from the frozen seed channel's representative titles;
- exact document affinity computed as cosine similarity between the frozen whole-channel seed document vector and each frozen title/channel/description candidate vector; when a frozen source-channel vector exists, use the maximum of candidate-video affinity and source-channel affinity so a narrowly worded video from an otherwise target-like source is not mistaken for a cross-topic transfer; use the result inversely as a novelty proxy rather than describing it as pure topic distance, and fall back explicitly to candidate affinity when source-channel coverage is absent;
- outlier proof computed as 75% frozen-corpus percentile of outlier score plus 25% frozen-corpus percentile of baseline evidence count; frozen confidence is reported as provenance but is not a ranking feature because all 9,385 eligible corpus rows are `confirmed`;
- deterministic result diversification with per-channel caps and maximal-marginal-relevance-style penalties.

The first slice does not use thumbnail vectors because the 498-item pilot has zero overlap with the frozen J5 dev pools (0/149 maker and 0/163 technology), so it cannot produce a fair common-input comparison. It reports that zero coverage and leaves a visual leg separate. It also does not mine historical transfers, train a learned ranker, assign BERTopic labels, or create a full-corpus packaging index. Those steps require a positive bounded signal first.

### 16.2 Frozen variants and gate

Define all recipes and weights in one versioned config before reading resolved judgments. Because only two dev tasks exist, there is one eligible primary recipe and two diagnostic ablations; the evaluation must not select whichever fixed recipe happens to look best after labels are joined:

1. `title_form`: diagnostic target-channel title-form compatibility plus outlier proof;
2. `cross_topic`: diagnostic ablation adding inverse frozen-document affinity;
3. `cross_topic_diverse`: the sole eligible primary, frozen as 0.60 document novelty + 0.25 title-form compatibility + 0.15 outlier proof, followed by deterministic diversification using 0.85 relevance minus 0.15 maximum raw-title-or-title-form similarity, with at most two results per source channel before deterministic backfill.

Run all three against the exact 149-candidate maker pool and 163-candidate technology pool. Stable entity id is the final tie-break. Evaluate only after all rankings and their input/config hashes are frozen. Report strict creative precision@10 and nDCG@20, the corresponding sensitivity calculation with unresolved items treated as relevant, direct-application rate@10, unresolved top-10 count, creative hits per task, latency, and feature-ablation deltas. Do not call the unresolved-as-relevant nDCG an upper bound because its larger ideal denominator can make the normalized value lower.

The primary may advance only if each task has lower creative precision@10 of at least 0.30, direct-application rate@10 of at most 0.20, at least one creative hit, zero unresolved top-10 results, and at least eight distinct source channels in its top 10. A dev pass authorizes only one newly frozen confirmation set; it does not authorize endpoints or corpus-wide indexing. If the primary fails, stop before historical weak-label mining or learned ranking and report that deterministic metadata features are insufficient. Ablations cannot rescue or replace a failed primary.

Budget: $0 paid model cost and no production writes. Qdrant reads are restricted to the 304 unique videos in the 312 frozen candidate-task pairs, the two seed channels, and the 141 unique candidate source channels. All generated artifacts are write-once or self-hashed and remain under `docs/prd/semantic-eval-v4/programmatic/`.

### 16.3 Work units

- [x] Add failing pure tests for title normalization, title-form features, document-novelty scoring, finite inputs, deterministic tie-breaking, channel caps, and diversity selection.
- [x] Implement the smallest reusable programmatic feature/ranking module and make the focused tests pass.
- [x] Freeze exact programmatic inputs and a pre-judgment variant config with complete upstream hashes and no label/rank/score leakage.
- [x] Run the fixed variants, then evaluate them against the existing resolved dev judgments and generate a reproducible report.
- [x] Run the full semantic Jest suite, touched-file TypeScript, artifact replay, and an independent fresh-context review.
- [x] Apply the gate literally: freeze one confirmation recipe only after a pass; otherwise record the stop without endpoints, full-corpus work, or historical weak-label mining.

### 16.4 Result

The sole eligible primary failed and no confirmation set was opened. `cross_topic_diverse` reached lower creative precision@10 of 0.60 for Make or Break Shop and 0.40 for Marques Brownlee, a large improvement over title-form-only at 0.10 and 0.00. It still failed the unchanged gate: Make or Break Shop had three unresolved top-10 items; Marques Brownlee had a 0.40 direct-application rate and one unresolved top-10 item. Diagnostic variants cannot rescue the primary.

Coverage was complete for all 304 candidate video vectors. Frozen source-channel vectors existed for 121 of 141 unique source channels and used the documented candidate-vector fallback otherwise. The 498-item thumbnail pilot overlapped 0 of 304 candidates. Exact blind and vector document hashes matched for all 312 task-candidate pairs. Local replay took about 1.1 seconds, added $0 paid model cost, and left total semantic spend conservatively bounded at $0.898715.

The input, config, and rankings were frozen before the reporting script loaded resolved judgments. However, an independent design subagent proposed the source-channel feature after inspecting dev-label behavior, so this result is explicitly exploratory rather than a clean blind estimate. Since the primary failed anyway, the stop is unchanged: no endpoint, corpus-wide packaging index, historical weak-label miner, or learned ranker ships from revision 5. Full tables and artifact links are in `docs/prd/2026-09-03-semantic-programmatic.md`.

A separate fresh-context reviewer reproduced the source hashes, exact blind bindings, live loopback-Qdrant affinities, all six rankings, all metrics, the literal gate failures, and the cost total. Its two non-blocking provenance/gate-hardening findings were fixed before completion. The final semantic suite passes 18 suites / 97 tests, and the strict touched-file TypeScript check is clean. Repository-wide `tsc --noEmit` remains red on extensive pre-existing app, worker, and stale `.next/types` errors outside this work.
