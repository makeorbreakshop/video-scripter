# PRD: Semantic layer v1 (local Qdrant, 30-day test)

Owner: Brandon Cullum. Implementer: Codex. Reviewer: Claude Code (this session's notes are in `~/shared-memory/knowledge/projects/video-scripter/`).
Status: active implementation; research amendments incorporated 2026-09-02. Date: 2026-09-02.

## 1. Why

ChannelSmith scores every video against its own channel (v3 scorer, `video_scores`). What it cannot do yet is relate videos and channels to each other by *meaning*: "channels like mine", "videos like this one", "what is beating baseline in laser content this month". The 2025 embeddings lived in Pinecone and are gone (account has zero indexes; the `pinecone_embedding_version` / `embedding_thumbnail_synced` flags on `videos` are stale and must be ignored). Topic labels from BERTopic (`videos.topic_domain/niche/micro`, 777 clusters) survived and are reusable as payload. The 5,337 surviving transcript chunk vectors are evidence for a later, targeted segment-search experiment, not a usable corpus-wide search layer and not part of v1.

This PRD is a bounded test: embed the last 30 days of long-form videos plus their channels into a local Qdrant, ship two similarity endpoints plus semantic modes on search/outliers, and measure whether semantic retrieval beats what we have (trigram channel search, library-wide outliers). Vectors move to Hetzner later by Qdrant snapshot; nothing here may depend on the machine.

## 2. Scope

In:
- Qdrant running locally in Docker (persistent volume, port 6333), reachable from scripts and the Next.js dev server. Pin the exact tested current release (`qdrant/qdrant:v1.19.0` as of 2026-09-02; record a digest if Docker resolves one) rather than floating `latest` or the obsolete v1.12 line. Use Qdrant's universal Query API; do not build new code on deprecated/removed `search` or `recommend` client methods. Config in `.env.local`: `QDRANT_URL`, `QDRANT_API_KEY` (optional locally).
- Embeddings for videos published in the last 30 days that are long-form (`coalesce(is_short,false)=false`, `duration <> 'P0D'`): ~47,000 rows today (`select count(*) from videos where published_at > now()-interval '30 days'` gave 46,959 on 2026-09-02).
- Embeddings for every channel that has at least one such video (~4,000).
- Text model: OpenAI `text-embedding-3-small`, `dimensions: 512`, cosine. Budget: ~$0.20 for titles; channel docs add ~$0.10.
- Two collections, `videos_v1` and `channels_v1`, with payloads (below).
- Incremental sync script + LaunchAgent (hourly) so new uploads and new channels land within an hour.
- API: `GET /api/v1/similar/videos/:id`, `GET /api/v1/similar/channels/:id`, `GET /api/v1/search?q=` gains `mode=semantic|lexical|hybrid` (default hybrid), `GET /api/v1/outliers` gains `topic=<free text>`. Results expose compact match evidence and truthful degradation metadata so an agent can decide whether to trust, refine, or broaden a query.
- Eval harness with a written result.

Out (v2):
- Thumbnail (CLIP) embeddings — waits for the local archive pass to finish (~2026-09-08).
- Corpus-wide transcript ingestion or transcript embeddings. In v2, test authorized, timestamped transcripts on a targeted set of high-value outliers first; §11 defines the gate.
- Audio/visual moment search. Text embeddings cannot answer visual-composition, shot, edit, music, or pacing questions.
- Full-corpus (873K) titles — same script, larger run, after the 30-day result is in.
- Hetzner deployment — a snapshot restore, documented as a runbook only.
- Any UI beyond an "also try" list on the add-channel search (optional, if cheap).

## 3. Data model

### 3.1 `videos_v1` (Qdrant collection)
- id: video id (string → Qdrant uuid5 of the id; keep the raw id in payload).
- vector: 512-d from the **video document**: `"{title}\n{channel_name}\n{topic_niche or ''}"`. Title alone is too short for many channels; channel name disambiguates ("Lazy Meals" is different on Allrecipes vs a gym channel).
- payload: `video_id, channel_id, channel_name, title, published_at (unix), view_count, topic_domain, topic_niche, topic_micro, format_type, score, confidence, est30, baseline, is_outlier (score>=2 and confidence in likely/confirmed), embedded_at`.
- Payload indexes: `channel_id` (keyword), `published_at` (integer, range), `topic_niche` (keyword), `is_outlier` (bool), `score` (float, range).

### 3.2 `channels_v1`
- id: channel id.
- vector: 512-d from the **channel document**: channel title + the titles of its 20 most-viewed videos in the window (fallback: last 20 uploads), one per line, plus its top 3 `topic_niche` values by count. One embedding call per channel.
- payload: `channel_id, name, subscriber_count, video_count, top_niches (array), baseline (median video_scores.baseline), outlier_rate (share of scored videos >= 2), lane (user|corpus), embedded_at`.
- Payload indexes: `subscriber_count` (integer, range), `top_niches` (keyword), and `lane` (keyword). Create all payload indexes before bulk ingestion.

### 3.3 Postgres bookkeeping
- New table `embeddings_v1 (entity text, id text, model text, dims int, doc_hash text, embedded_at timestamptz, primary key (entity, id))`. Re-embed only when `doc_hash` changes (title edit, channel document drift). This replaces the stale Pinecone flags; do not touch those columns.

## 4. Scripts

All in `scripts/semantic/`, TypeScript, run with `npx tsx`, direct Postgres via `pg` (never the Supabase JS client), statement_timeout-safe (batch reads of 5,000 ids, indexed predicates). Idempotent, resumable, `--dry` supported.

1. `qdrant-up.sh`: `docker run -d --name channelsmith-qdrant -p 6333:6333 -v ~/qdrant/channelsmith:/qdrant/storage qdrant/qdrant:v1.19.0`; creates the two collections and all payload indexes in §3 if missing (cosine, 512, on-disk payload, HNSW default). Record the tested server/client versions in the eval report.
2. `embed-videos.ts [--since 30d] [--limit N]`: builds video documents, batches 256 per OpenAI call, upserts to Qdrant in batches of 500, writes `embeddings_v1`. Rate: cap at 3,000 requests/min; retry with backoff on 429.
3. `embed-channels.ts [--since 30d]`: same for channels.
4. `sync-semantic.ts`: incremental (new or changed docs since last run; also refreshes `score/is_outlier/view_count` payload for videos scored in the last hour without re-embedding). Installed as `com.mfm.video-scripter-semantic` LaunchAgent, hourly, modelled on `com.mfm.video-scripter-score.plist`.
5. `eval-semantic.ts`: the harness in §6; writes `docs/prd/2026-09-02-semantic-eval.md`.

Quota/cost logging: every OpenAI call logs tokens to a `semantic_cost_ledger (date, tokens, usd)` table; print the day's total at the end of each run.

## 5. API

Auth, rate limiting, error shape, and the `score` object shape are the existing v1 conventions (`lib/api/v1.ts`, `docs/api-v1.md`).

- `GET /api/v1/similar/videos/:id?limit=20&exclude_channel=true&since=<ISO>` → `{ video, similar: [{ id, rank, title, channel:{id,name}, published_at, view_count, score, similarity, match_evidence }] }`. Uses the stored vector (no re-embedding at request time). 404 if the video is not embedded.
- `GET /api/v1/similar/channels/:id?limit=20&min_subscribers=&max_subscribers=&lane=&exclude_ids=` → `{ channel, similar: [{ id, rank, name, subscriber_count, top_niches, baseline, outlier_rate, similarity, match_evidence, tracked }] }`. Filters are optional, indexed, and applied inside Qdrant. `exclude_ids` is capped at 100.
- `GET /api/v1/search?q=&mode=hybrid|semantic|lexical&limit=&min_subscribers=&max_subscribers=&lane=&niche=&exclude_ids=` → semantic: embed `q` (one OpenAI call, cached in memory 10 min by normalized query string) and search `channels_v1`; lexical: current `searchTracked`; hybrid: reciprocal-rank fusion of both. Apply the same supported filters to both legs before fusion so `mode` comparisons mean the same thing. Each result adds `rank`, `source: semantic|lexical|both`, and `match_evidence`.
- `GET /api/v1/outliers?topic=<free text>&since=&min_score=&limit=&max_per_channel=` → embeds `topic`, searches `videos_v1` with filter `is_outlier=true and published_at>=since`, returns the existing outliers shape plus `rank`, `similarity`, and `match_evidence`. `max_per_channel` defaults to 1 for topical discovery so one prolific channel cannot crowd out independent examples; allow `0` to disable grouping. Without `topic`, behaviour is unchanged.

### 5.1 Agent-facing response contract

An agent needs to know not only *what* matched but *why* and under which retrieval path. All four endpoints therefore follow these rules:

- Return `requested_mode`, `effective_mode`, and `degraded` at the top level wherever fallback is possible. If Qdrant is down and hybrid search falls back to lexical, report `requested_mode: "hybrid"`, `effective_mode: "lexical"`, `degraded: true`; never silently label fallback output as hybrid.
- `similarity` is raw cosine similarity, useful for ranking within this collection/version only. It is **not confidence or probability**, must not be rendered as a percent, and must be omitted for a lexical-only result.
- `match_evidence` is a compact, bounded object, not an LLM explanation: for example `{ semantic_fields:["top_titles","top_niches"], lexical_fields:["name"], matched_niches:["laser engraving"] }`. Never return the full embedded document by default.
- Echo normalized filters, window/coverage (`embedded_since`, collection/version), and a stable result id. This lets an agent cite the evidence, detect unsupported scope, and make a narrower follow-up call.
- Reject unsupported filters with the normal v1 400 error rather than ignoring them. Cap `limit` and exclusion lists using existing v1 conventions.

### 5.2 Human UI guidance (not an acceptance blocker for v1)

If the optional add-channel UI is built, keep one search box and make intent legible in the results instead of exposing vector-database language. Show an exact/name match section first when present, then "Related channels"; include a short "Matched on" line (niche or representative title), active filter chips (subscriber band, niche, tracked/corpus), and a clear lexical-fallback notice. Do not show raw cosine similarity. For outlier exploration, default to one result per channel and let the user expand a channel. A useful next action is "find more like this" from every channel/video result.

## 6. Evaluation: "how much better does it perform?"

Four measurable questions, each with a baseline or task criterion. Run before shipping; results go in the eval doc with the exact commands. Retrieval quality is primary; outlier enrichment is diagnostic rather than a substitute for relevance labels.

1. **Channel search quality.** Build 40 queries from the actual library and stratify them in the gold file: 10 known-item/name/handle/typo queries, 20 topical discovery queries, and 10 analogue queries that express audience, format, or hook rather than literal niche words. For each query, pool the top 10 from lexical, semantic, and hybrid, deduplicate, randomize, and label each candidate `0=irrelevant`, `1=useful`, or `2=highly useful`; retain at least 5 positive expected channels where the library supports them. Report recall@10 and MRR for the known-item stratum and NDCG@10 (primary) plus recall@10 for discovery/analogue strata. Pass: hybrid known-item MRR is no worse than lexical by more than 0.02, hybrid discovery/analogue NDCG@10 is ≥ lexical +0.10 absolute, and hybrid recall@10 exceeds lexical. If no semantic or hybrid variant beats trigram on the discovery/analogue strata, say so and stop.
2. **Similar videos usefulness.** For 200 random outlier videos in the window, take the top-10 semantic neighbours excluding the same channel. Keep neighbour outlier-rate lift versus the library base rate as a secondary signal. Primary manual evaluation: blindly grade a fixed sample of 100 pairs on topic (`0–2`), format/hook (`0–2`), and transferability to another creator (`0–2`), and report unique channels/niches in each top-10 list. Pass: mean total grade ≥4/6, at least 80% of lists contain ≥5 unique channels, and neighbour outlier rate ≥2× base rate. Also report median similarity, but do not infer a universal relevance threshold from it.
3. **Topic outliers precision.** For 15 topic queries, label the top-20 `outliers?topic=` results as on-topic/off-topic (Claude labels, Brandon spot-checks 3 queries). Metric: precision@20. Pass: ≥ 0.8.
4. **Agent task utility.** Run 12 fixed tasks across the real API: four known-channel lookups, four constrained analogue searches (including a subscriber band), and four topical-outlier investigations that require three independent channels. Record task success, number of API calls, response bytes, whether match evidence was sufficient to choose a result without fetching every channel/video, and whether fallback was correctly detected. Pass: ≥10/12 tasks succeed in ≤3 calls each and every degraded run is recognized from the response alone.

For Qdrant itself, measure approximate top-10 recall against exact search on 100 sampled queries and require ≥0.95 before interpreting product-quality results.

Also report: total cost (USD), wall time, Qdrant RAM/disk, p95 latency of each endpoint over 200 requests, and the size of a Qdrant snapshot (for the Hetzner move).

## 7. Non-functional

- Nothing writes to Supabase except `embeddings_v1` and the cost ledger (small, indexed inserts). Reads are batched and indexed; no full-table scans (the videos table is 873K rows).
- Never log or print API keys. Keys stay in `.env.local` / 1Password.
- The Next.js app must run without Qdrant: if `QDRANT_URL` is unset or the container is down, semantic endpoints return 503 `{error:{code:'semantic_unavailable'}}` and `search` falls back to lexical.
- Transcript or media enrichment may only use an authorized, documented source with stored provenance. A public-caption convenience endpoint from a third party is not, by itself, evidence that corpus-wide downloading and retention is permitted.
- Snapshot runbook: `POST /collections/{name}/snapshots`, copy the two files, restore on Hetzner with `?snapshot` upload; document in `docs/runbooks/qdrant-move.md`.

## 7a. Permissions and cost control

- Codex may start the Qdrant Docker container and load the `com.mfm.video-scripter-semantic` LaunchAgent on this machine without asking (Brandon, 2026-09-02).
- **Cost gate before every embedding run.** Count the exact input tokens locally first (tiktoken `cl100k_base` over the built documents), print `docs, tokens, est_usd` using the current price for `text-embedding-3-small` (check https://openai.com/api/pricing before the first run and record the number used in the run log; do not rely on a remembered price), and refuse to call the API if the estimate exceeds the run's `--max-usd` (default 2.00 for the 30-day window, 25.00 for a full-corpus run). Log actual usage from the API response (`usage.total_tokens`) into `semantic_cost_ledger` and print the day's total at the end. If actual exceeds estimate by more than 20%, stop and report.
- Never re-embed unchanged documents (`doc_hash` in `embeddings_v1`); the experiments in §10 must reuse vectors across variants where the document is identical.

## 8. Acceptance

- `docker ps` shows the container; both collections exist with counts within 2% of the SQL counts for the window.
- Hourly sync adds a video published 10 minutes ago within the next run.
- All four endpoints documented in `docs/api-v1.md` with curl examples and return real data for: video `MpGDoiSH_PQ`, channel `UCjWkNxpp3UHdEavpM_19--Q`, query "laser engraver", topic "air fryer recipes". Examples document `requested_mode`, `effective_mode`, `degraded`, `rank`, `source`, `match_evidence`, filters, coverage/version, and the fact that similarity is uncalibrated.
- Eval doc written with the four evaluations, pass/fail, and the cost line (estimated vs actual USD per run).
- Tests: document builders (pure), RRF fusion (pure), payload mapping, and the 503 fallback. `npx jest` green; `npx tsc --noEmit` clean on touched files.
- Commits on `main`, small, prefixed `semantic:`; no push without Brandon.

## 9. Known facts for the implementer

- DB: direct Postgres via `DATABASE_URL` (transaction pooler, statement_timeout 45s on app connections; scripts may `set statement_timeout` per connection).
- Tables: `videos` (id, channel_id, channel_name, title, published_at, view_count, is_short, duration, topic_*, format_type), `video_scores` (score, confidence, est30, baseline), `channel_meta` (title, avatar_url, subscriber_count), `channel_tracking` (lane), `user_channels`.
- Existing lexical search: `lib/app/channels.ts searchTracked` over `channel_directory` with `pg_trgm`.
- Existing API plumbing: `lib/api/v1.ts` (`withApiKey`, `jsonError`, `intParam`, `listParam`, `scoreShape`).
- OpenAI key: `OPENAI_API_KEY` in `.env.local`.

## 10. Method experiments (decide the document and the search before scaling)

The 2025 system taught three things that this PRD must not relearn the hard way (see `IDEA_HEIST_SYSTEM_SUMMARY.md`, `docs/logs/archive_logs/daily_log-2025-07-19.md`, `-07-27.md`):

1. Title embeddings capture literal wording; **LLM-summary embeddings capture the concept**. The old system searched both (thresholds 0.5 titles / 0.4 summaries) and merged. 423915 videos still have an `llm_summary` in Postgres (0 in the 30-day window), reusable for free.
2. **Thread expansion was too narrow**: expanding a laser query only found laser variations. The fix that worked was expanding the *query* into several abstracted formulations (audience problem, format, emotional hook) and filtering results for transferability, not a bigger k.
3. Summaries cost ~$1,700 per 170K videos in 2025; titles cost dollars. So summaries are a targeted spend, not a default.

Run these as part of the eval (same gold sets as §6), before the full-corpus run:

| Experiment | Variants | Decide by |
|---|---|---|
| A. Video document | (1) title only · (2) title + channel name + niche (default) · (3) title + description first 300 chars (free, already stored) | §6.2 neighbour outlier rate and the manual read; cost per 1K docs |
| B. Dimensions | 512 vs 1536 (same model) | §6.1 recall@10; if within 0.02, keep 512 (3× smaller, faster) |
| C. Channel document | (1) name + top-20 titles (default) · (2) name + top-20 titles + top niches · (3) mean of the channel's video vectors (no extra embedding call) | §6.1 recall@10 / MRR |
| D. Query strategy | (1) raw query · (2) hybrid RRF with lexical (default) · (3) multi-query expansion: an LLM rewrites the query into 3 forms (literal, audience problem, format/hook), union by RRF · (4) query + "for YouTube creators" prefix | §6.1 and §6.3 precision; latency budget 400 ms p95 for (3) with the expansion cached |
| E. Similarity floor | none · 0.35 · 0.5 (cosine) | §6.2/§6.3: precision vs empty-result rate; report the curve |
| F. Channel intent representation | (1) one aggregate channel vector (default) · (2) separate identity/topic and breakout-format vectors, fused by RRF · (3) mean of video vectors plus lexical | §6.1 by stratum and §6.4; use multiple named vectors only if the intent-specific representation materially improves analogue discovery without hurting known-item lookup |

Rules: one variant changes at a time against the default; every run logs cost and p95 latency; results in the eval doc as a table with the winner per row and one sentence on why. The winner of A and D becomes the default for the full-corpus run; the rest stay as documented options. If no variant clears the §6 pass bars, stop and report rather than shipping semantic search that is not better than trigram.

Budget for the experiments: the 30-day window re-embedded ~4 ways is ~$1–2. Decision 2026-09-02 (Brandon): no LLM summaries in v1, existing or new; their value is unproven and the cost is real. Revisit only if title-based variants fail the §6 bars.

## 11. Transcript and multimodal search: usefulness and the v2 gate

Competitor research shows two different products that are easy to conflate:

1. **Corpus retrieval:** find channels, topics, outliers, and analogous packaging across millions of videos. Titles, descriptions, channel identity, topic labels, scores, and structured filters do most of this job cheaply and audibly.
2. **Inside-video analysis:** after a promising video is selected, inspect its hook, claims, steps, story structure, phrasing, or a specific moment. Timestamped transcript segments are highly useful here. Visual/audio embeddings are needed for composition, shots, edits, objects, music, and pacing that captions never say aloud.

Observed market behavior as of 2026-09-02 supports this split. 1of10 publicly emphasizes outliers, titles, thumbnails, and idea generation; no verified product documentation was found showing transcript-based corpus search. OutlierKit and TubeLab expose timestamped transcript endpoints, and TubeLab exposes transcript retrieval as a separate agent tool alongside channel/outlier search. Prepostr reads a creator's own transcript to package that video. vidIQ exposes video summary/hook-analysis actions, but its public documentation does not establish how it acquires or indexes transcripts. Do not infer competitor internals beyond those published claims.

Therefore:

- Do **not** add transcript ingestion to this v1 or embed all 873K videos. Chunking would multiply vector count, storage, sync work, provenance risk, and irrelevant matches before we have shown incremental value.
- After v1 identifies promising videos, run a v2 experiment on an authorized sample: user-requested video ids, the strongest outliers, and owned/connected channels. Cache timestamped segments with `video_id`, `start_ms`, `end_ms`, `text`, `language`, `source`, `source_fetched_at`, `rights_basis`, and embedding version.
- Expose segment retrieval separately (`/videos/:id/segments/search` or an agent tool), returning timestamps and short excerpts. Do not mix segment hits into channel search.
- Evaluate transcript search against title+description on tasks where it should win: identify the opening hook, retrieve a stated technique/claim, compare narrative structure, and locate the moment where a concept is discussed. Require a material task-success gain before scaling.
- For visual similarity, wait for the archive and evaluate dedicated clip/image embeddings against visual tasks. State-of-the-art multimodal video embeddings are promising but task-dependent; no single representation should be assumed to serve topic, action, temporal, audio, and packaging similarity equally well.
- Prefer staged enrichment: metadata → candidate retrieval → transcript/visual fetch for a small candidate set → agent synthesis with cited timestamps. This is more useful to an agent than returning a huge opaque semantic blob and far cheaper than enriching the whole corpus.

The product decision is explicit: **transcripts are high-value evidence after retrieval, but low-priority input for v1 channel/outlier discovery.** Revisit when the v1 eval reveals a task that titles/descriptions cannot answer and an authorized acquisition path exists.

Research record: Qdrant's current Query API, hybrid/multi-stage query, multi-representation, relevance-feedback, and MMR documentation; OpenAI's current `text-embedding-3-small` model/pricing documentation; TwelveLabs Marengo 3.5 and Google multimodal embedding documentation; Adobe Premiere's modality-specific media search; the 2026 MVEB and MomentSeeker evaluations; and the published product/API documentation for 1of10, OutlierKit, TubeLab, Prepostr, and vidIQ. Internal product guidance is in `~/shared-memory/knowledge/projects/video-scripter/2026-09-01-api-prior-decisions-synthesis.md`, `2026-09-01-creator-jobs-to-be-done.md`, `2026-09-01-creator-research-opus-review.md`, and `2026-09-01-outlierkit-osint.md`.
