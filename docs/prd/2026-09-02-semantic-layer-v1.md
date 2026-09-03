# PRD: Semantic layer v1 (local Qdrant, 30-day test)

Owner: Brandon Cullum. Implementer: Codex. Reviewer: Claude Code (this session's notes are in `~/shared-memory/knowledge/projects/video-scripter/`).
Status: draft for implementation. Date: 2026-09-02.

## 1. Why

ChannelSmith scores every video against its own channel (v3 scorer, `video_scores`). What it cannot do yet is relate videos and channels to each other by *meaning*: "channels like mine", "videos like this one", "what is beating baseline in laser content this month". The 2025 embeddings lived in Pinecone and are gone (account has zero indexes; the `pinecone_embedding_version` / `embedding_thumbnail_synced` flags on `videos` are stale and must be ignored). Topic labels from BERTopic (`videos.topic_domain/niche/micro`, 777 clusters) and 5,337 transcript chunk vectors in Postgres survived and are reusable as payload.

This PRD is a bounded test: embed the last 30 days of long-form videos plus their channels into a local Qdrant, ship two API endpoints and one eval harness, and measure whether semantic retrieval beats what we have (trigram channel search, library-wide outliers). Vectors move to Hetzner later by Qdrant snapshot; nothing here may depend on the machine.

## 2. Scope

In:
- Qdrant running locally in Docker (`qdrant/qdrant`, persistent volume, port 6333), reachable from scripts and the Next.js dev server. Config in `.env.local`: `QDRANT_URL`, `QDRANT_API_KEY` (optional locally).
- Embeddings for videos published in the last 30 days that are long-form (`coalesce(is_short,false)=false`, `duration <> 'P0D'`): ~47,000 rows today (`select count(*) from videos where published_at > now()-interval '30 days'` gave 46,959 on 2026-09-02).
- Embeddings for every channel that has at least one such video (~4,000).
- Text model: OpenAI `text-embedding-3-small`, `dimensions: 512`, cosine. Budget: ~$0.20 for titles; channel docs add ~$0.10.
- Two collections, `videos_v1` and `channels_v1`, with payloads (below).
- Incremental sync script + LaunchAgent (hourly) so new uploads and new channels land within an hour.
- API: `GET /api/v1/similar/videos/:id`, `GET /api/v1/similar/channels/:id`, `GET /api/v1/search?q=` gains `mode=semantic|lexical|hybrid` (default hybrid), `GET /api/v1/outliers` gains `topic=<free text>`.
- Eval harness with a written result.

Out (v2):
- Thumbnail (CLIP) embeddings — waits for the local archive pass to finish (~2026-09-08).
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

### 3.3 Postgres bookkeeping
- New table `embeddings_v1 (entity text, id text, model text, dims int, doc_hash text, embedded_at timestamptz, primary key (entity, id))`. Re-embed only when `doc_hash` changes (title edit, channel document drift). This replaces the stale Pinecone flags; do not touch those columns.

## 4. Scripts

All in `scripts/semantic/`, TypeScript, run with `npx tsx`, direct Postgres via `pg` (never the Supabase JS client), statement_timeout-safe (batch reads of 5,000 ids, indexed predicates). Idempotent, resumable, `--dry` supported.

1. `qdrant-up.sh`: `docker run -d --name channelsmith-qdrant -p 6333:6333 -v ~/qdrant/channelsmith:/qdrant/storage qdrant/qdrant:v1.12.x`; creates the two collections if missing (cosine, 512, on-disk payload, HNSW default).
2. `embed-videos.ts [--since 30d] [--limit N]`: builds video documents, batches 256 per OpenAI call, upserts to Qdrant in batches of 500, writes `embeddings_v1`. Rate: cap at 3,000 requests/min; retry with backoff on 429.
3. `embed-channels.ts [--since 30d]`: same for channels.
4. `sync-semantic.ts`: incremental (new or changed docs since last run; also refreshes `score/is_outlier/view_count` payload for videos scored in the last hour without re-embedding). Installed as `com.mfm.video-scripter-semantic` LaunchAgent, hourly, modelled on `com.mfm.video-scripter-score.plist`.
5. `eval-semantic.ts`: the harness in §6; writes `docs/prd/2026-09-02-semantic-eval.md`.

Quota/cost logging: every OpenAI call logs tokens to a `semantic_cost_ledger (date, tokens, usd)` table; print the day's total at the end of each run.

## 5. API

Auth, rate limiting, error shape, and the `score` object shape are the existing v1 conventions (`lib/api/v1.ts`, `docs/api-v1.md`).

- `GET /api/v1/similar/videos/:id?limit=20&exclude_channel=true&since=<ISO>` → `{ video, similar: [{ id, title, channel:{id,name}, published_at, view_count, score, similarity }] }`. Uses the stored vector (no re-embedding at request time). 404 if the video is not embedded.
- `GET /api/v1/similar/channels/:id?limit=20` → `{ channel, similar: [{ id, name, subscriber_count, top_niches, baseline, outlier_rate, similarity, tracked }] }`.
- `GET /api/v1/search?q=&mode=hybrid|semantic|lexical&limit=` → semantic: embed `q` (one OpenAI call, cached in memory 10 min by query string) and search `channels_v1`; lexical: current `searchTracked`; hybrid: reciprocal-rank fusion of both. Response adds `mode` and per-result `source: semantic|lexical|both`.
- `GET /api/v1/outliers?topic=<free text>&since=&min_score=&limit=` → embeds `topic`, searches `videos_v1` with filter `is_outlier=true and published_at>=since`, returns the existing outliers shape plus `similarity`. Without `topic`, behaviour is unchanged.

## 6. Evaluation: "how much better does it perform?"

Three measurable questions, each with a baseline that exists today. Run before shipping; results go in the eval doc with the exact commands.

1. **Channel search quality.** Gold set: 40 queries Brandon and Claude write from real intents ("laser engraver reviews", "woodworking builds with epoxy", "AI tools news", "home cooking hacks", "3D printing", …) with the 5 channels a maker would expect for each (pick from the library; store as `docs/prd/semantic-gold-channels.json`). Metric: recall@10 and MRR for lexical (today), semantic, hybrid. Pass: hybrid recall@10 ≥ lexical + 0.25 absolute.
2. **Similar videos usefulness.** For 200 random outlier videos in the window, take the top-10 semantic neighbours excluding the same channel. Metric: share of neighbours that are themselves outliers (score ≥ 2) versus the library base rate (≈10% of scored videos). Pass: neighbour outlier rate ≥ 2× base rate. Also report the median similarity of neighbours and a manual read of 10 lists (are they actually the same kind of video?).
3. **Topic outliers precision.** For 15 topic queries, label the top-20 `outliers?topic=` results as on-topic/off-topic (Claude labels, Brandon spot-checks 3 queries). Metric: precision@20. Pass: ≥ 0.8.

Also report: total cost (USD), wall time, Qdrant RAM/disk, p95 latency of each endpoint over 200 requests, and the size of a Qdrant snapshot (for the Hetzner move).

## 7. Non-functional

- Nothing writes to Supabase except `embeddings_v1` and the cost ledger (small, indexed inserts). Reads are batched and indexed; no full-table scans (the videos table is 873K rows).
- Never log or print API keys. Keys stay in `.env.local` / 1Password.
- The Next.js app must run without Qdrant: if `QDRANT_URL` is unset or the container is down, semantic endpoints return 503 `{error:{code:'semantic_unavailable'}}` and `search` falls back to lexical.
- Snapshot runbook: `POST /collections/{name}/snapshots`, copy the two files, restore on Hetzner with `?snapshot` upload; document in `docs/runbooks/qdrant-move.md`.

## 7a. Permissions and cost control

- Codex may start the Qdrant Docker container and load the `com.mfm.video-scripter-semantic` LaunchAgent on this machine without asking (Brandon, 2026-09-02).
- **Cost gate before every embedding run.** Count the exact input tokens locally first (tiktoken `cl100k_base` over the built documents), print `docs, tokens, est_usd` using the current price for `text-embedding-3-small` (check https://openai.com/api/pricing before the first run and record the number used in the run log; do not rely on a remembered price), and refuse to call the API if the estimate exceeds the run's `--max-usd` (default 2.00 for the 30-day window, 25.00 for a full-corpus run). Log actual usage from the API response (`usage.total_tokens`) into `semantic_cost_ledger` and print the day's total at the end. If actual exceeds estimate by more than 20%, stop and report.
- Never re-embed unchanged documents (`doc_hash` in `embeddings_v1`); the experiments in §10 must reuse vectors across variants where the document is identical.

## 8. Acceptance

- `docker ps` shows the container; both collections exist with counts within 2% of the SQL counts for the window.
- Hourly sync adds a video published 10 minutes ago within the next run.
- All four endpoints documented in `docs/api-v1.md` with curl examples and return real data for: video `MpGDoiSH_PQ`, channel `UCjWkNxpp3UHdEavpM_19--Q`, query "laser engraver", topic "air fryer recipes".
- Eval doc written with the three metrics, pass/fail, and the cost line (estimated vs actual USD per run).
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

Rules: one variant changes at a time against the default; every run logs cost and p95 latency; results in the eval doc as a table with the winner per row and one sentence on why. The winner of A and D becomes the default for the full-corpus run; the rest stay as documented options. If no variant clears the §6 pass bars, stop and report rather than shipping semantic search that is not better than trigram.

Budget for the experiments: the 30-day window re-embedded ~4 ways is ~$1–2. Decision 2026-09-02 (Brandon): no LLM summaries in v1, existing or new; their value is unproven and the cost is real. Revisit only if title-based variants fail the §6 bars.
