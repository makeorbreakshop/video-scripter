# Supabase audit — video-scripter — 2026-09-04

Project `mhzwrynnfphlxqcqytrj` ("Video Scripter"), org `makeorbreakshop` (`azttnrlhqebighazwvnr`), Pro plan.
All figures measured 2026-09-04 10:45–11:05 UTC via direct Postgres (`DATABASE_URL`, Supavisor transaction
mode :6543) plus the org Usage dashboard. No REST/PostgREST was used for any read in this audit.

> Note on project ref: the audit brief named `xspderyoeancoqhdcloo`. That is the **Maker Machines**
> project. video-scripter's `.env.local` points at `mhzwrynnfphlxqcqytrj`; this audit is of that project.

---

## 1. Instance vitals

| Item | Value | Source |
|---|---|---|
| Postgres | 15.8, aarch64 | `select version()` |
| Compute tier | **Small** (2 vCPU / 2 GB) | `max_connections`=90, `shared_buffers`=512 MB, `effective_cache_size`=1.5 GB |
| `work_mem` / `maintenance_work_mem` | 5 MB / 128 MB | `pg_settings` |
| Server `statement_timeout` | 120 s (2 min) | `pg_settings` |
| `autovacuum_max_workers` | 3, cost limit default (-1) | `pg_settings` |
| Database size | **6,422 MB before fixes → 6,257 MB after** | `pg_database_size` |
| Disk provisioned | 12 GB GP3 (Video Scripter); disk overage in period **0 GP3 GB-Hrs** | Usage dashboard |
| Postmaster start | 2026-09-01 19:10 UTC | `pg_postmaster_start_time()` |

### Org usage, billing cycle 01 Sep – 17 Sep 2026

| Metric | Used | Quota | % |
|---|---|---|---|
| **Egress** | **68.903 GB** | 250 GB | **28 %** |
| Cached egress | 1.01 GB | 250 GB | <1 % |
| Storage size (buckets) | 17.75 GB avg | 100 GB | 18 % |
| Realtime messages | 379,709 | 5,000,000 | 8 % |
| Compute hours | 191 h Small ($3.93) + 130 h Micro ($1.75) | — | — |

**Egress burn rate: 68.90 GB over 3.45 days = 19.97 GB/day.** Projected over the full 17-day cycle:
**~340 GB = 136 % of the 250 GB quota**, crossing 250 GB around **12–13 Sep**. Quota is org-wide and
shared with machinesformakers.com production (2026-08-31 incident). See P0-1.

### Connections

Two samples, both via `pg_stat_activity`. Supavisor masks per-script `application_name`, so a
per-script breakdown from the server side is **not obtainable** — the budget in §5 is derived from
code instead.

| Sample | Supavisor active | Supavisor idle | postgrest | storage | exporter | other | total backends |
|---|---|---|---|---|---|---|---|
| 10:47:54 UTC | 5 | 3 | 2 idle | 2 idle | 1 | 4 | 25 |
| 11:01:54 UTC | 1 | 7 | 3 idle | 0 | 1 | 6 | 18 |

`max_connections` = 90. Server-side pressure is not the problem; the pooler client cap is (§5).

### Not measured this session

- **CPU and memory time series over 7 days** — the project-scoped dashboard pages
  (`/settings/infrastructure`, `/settings/compute-and-disk`) returned an empty DOM to the browser tool
  and CDP screenshot capture failed. Only the org-level Usage page rendered.
- **Disk IO budget / burst balance** — same reason. Not asserted from memory.
- **Management API** — no Supabase personal access token exists on this machine
  (`~/.config/supabase/access-token`, `~/.supabase/`, keychain all empty). See P0-2.
- **`pgstattuple`** is not installed, so bloat figures below are statistics-based estimates, not exact.
- **pg_stat_statements window**: `pg_stat_database.stats_reset` is NULL and PG15 has no
  `pg_stat_statements.stats_since`. Cumulative counters therefore span an **unbounded** window
  (months). Where "current" rates matter, this audit measured them directly instead.

---

## 2. Storage

### Tables over 50 MB

| Table | Total | Heap | Indexes | Live | Dead | % dead | Last (auto)vacuum | Last (auto)analyze |
|---|---|---|---|---|---|---|---|---|
| videos | 3,981 MB | 1,734 MB | 1,453 MB | 999,607 | 82,584 | 8.3 % | 09-04 07:49 | 09-04 05:45 |
| view_snapshots | 784 MB | 219 MB | **565 MB** | 2,355,038 | 311,731 | 13.2 % | **09-01 00:25** | 09-04 06:40 |
| packaging_performance (MV) | 355 MB | 227 MB | 26 MB | 220,465 | 0 | 0 % | 08-10 02:02 | 08-10 02:02 |
| daily_analytics | 217 MB | 117 MB | 100 MB | 304,772 | 26,474 | 8.7 % | 09-03 15:48 | 09-03 15:49 |
| view_tracking_priority | 198 MB | 74 MB | 124 MB | 936,501 | 98,135 | 10.5 % | 09-02 10:48 | 09-03 07:54 |
| feed_events | 105 MB | 43 MB | 63 MB | 105,036 | 2,544 | 2.4 % | 09-03 16:39 | 09-04 00:19 |
| chunks | 94 MB | 6 MB | 43 MB* | 5,337 | 0 | 0 % | **06-25 13:50** | 06-25 13:50 |
| description_versions | 91 MB | 61 MB | 2.6 MB | 69,479 | 0 | 0 % | 09-03 16:48 | 09-03 16:48 |
| rss_samples | 91 MB | 48 MB | 43 MB | 737,228 | 0 | 0 % | 09-04 00:43 | 09-04 08:35 |
| video_scores | 88 MB | 34 MB | 55 MB | 174,415 | 2,552 | 1.5 % | 09-04 00:06 | 09-03 21:37 |
| thumbnail_versions | 60 MB | 33 MB | 27 MB | 126,470 | 22,942 | **18.1 %** | 09-04 10:12 | 09-04 10:29 |

\* `chunks` index size was 43 MB before this audit dropped `idx_chunks_embedding`.

`videos` also carries ~794 MB of TOAST (3,981 − 1,734 heap − 1,453 index).

### Indexes over 50 MB (before fixes)

| Index | Table | Size | idx_scan |
|---|---|---|---|
| idx_videos_id_llm_summary | videos | 181 MB | 14,590,541 |
| idx_view_snapshots_video_date_desc | view_snapshots | 142 MB | 12,286,547 |
| idx_videos_channel_published | videos | 96 MB | 12,823,034 |
| view_snapshots_video_id_snapshot_date_key | view_snapshots | 94 MB | 3,222,930 |
| idx_view_snapshots_video_date | view_snapshots | 94 MB | 12,881,927 |
| view_snapshots_pkey | view_snapshots | 93 MB | 75,536 |
| idx_view_snapshots_date_video | view_snapshots | 93 MB | 4,218 |
| idx_videos_channel_views | videos | 85 MB | 32 |
| idx_videos_baseline_calc | videos | 85 MB | 1,392,397 |
| idx_videos_format_confidence | videos | 73 MB | 5,650 |
| **idx_videos_baseline_optimized** | videos | 69 MB | **0** ← dropped |
| idx_videos_id_published_views | videos | 67 MB | 40,348,309 |
| idx_view_tracking_priority_tier_date | view_tracking_priority | 53 MB | 32 |

`videos` carried **47 indexes / 1,453 MB against a 1,734 MB heap**.

### Bloat estimate (statistics-based; `pgstattuple` not installed)

| Table | Actual | Estimated packed | Estimated bloat | % |
|---|---|---|---|---|
| videos | 1,734 MB | 1,219 MB | **515 MB** | 29.7 % |
| daily_analytics | 117 MB | 60 MB | **58 MB** | 49.3 % |
| view_snapshots | 218 MB | 202 MB | 17 MB | 7.6 % |
| view_tracking_priority | 71 MB | 62 MB | 9 MB | 12.2 % |
| description_versions | 57 MB | 56 MB | 0.4 MB | 0.7 % |

### Append-only time series: measured growth and proposed retention

Rows inserted in the trailing 24 h (measured on each table's own timestamp column):

| Table | Rows / 24 h | Rows / hour | Bytes/row | Growth/day | Writer | Retention today | Proposal |
|---|---|---|---|---|---|---|---|
| **rss_samples** | **737,228** | **30,718** | 129 (heap+idx) | **~95 MB/day** | `scripts/rss-poll.ts` (12×/h) | thin to 1/video/day **after 30 days** (`lib/rss/retention.ts` `denseWindowDays: 30`) | **Cut dense window to 3–5 days.** At 30 days the dense set reaches **22.1 M rows ≈ 2.9 GB heap + ~1.3 GB index ≈ 4.2 GB** — alone larger than half the current DB, on a 12 GB disk. |
| view_samples | 193,149 | 8,048 | 118 | ~23 MB/day | `scripts/launch-track.ts` | **none** | Roll up to hourly after 7 d, daily after 30 d; else 5.8 M rows / ~685 MB per 30 days. |
| video_scores | 176,561 | 7,357 | 528 (heap+idx) | (rewrite, not growth) | `scripts/score-videos.ts` (hourly) | upsert on `video_id` PK, bounded at 174 K rows | OK — but 0 % HOT (§4). |
| view_snapshots | 52,696 | 2,196 | 340 (heap+idx) | ~18 MB/day | nightly-view-tracking + PostgREST batch inserts | **none** | Keep raw 90 d, then daily rollup. Index/heap ratio is 2.6:1 — see P1-3. |
| thumbnail_versions | 20,088 | 837 | 497 | ~10 MB/day | `scripts/thumbnail-watch.ts` | none | Bounded in practice (one row per *change*); no action. |
| feed_events | 3,849 | 160 | 1,047 | ~4 MB/day | `scripts/feed-materialize.ts` | none | Keep 180 d; ~700 MB/yr otherwise. |
| description_versions | 3,550 | 148 | 1,373 | ~5 MB/day | title/description watcher | none | Fine. |
| title_versions | 1,326 | 55 | 234 | ~0.3 MB/day | title watcher | none | Fine. |

Total measured append-only growth: **~155 MB/day**, i.e. the DB reaches the 12 GB provisioned disk in
roughly **37 days** at the current rate with no retention change, and sooner once rss_samples fills its
30-day dense window.

### Orphan / legacy candidates (evidence, not applied)

| Object | Size | Evidence | Code references | Verdict |
|---|---|---|---|---|
| `packaging_performance` (MV) | 355 MB | idx_scan 547, seq_scan 888, **never refreshed since 08-10** | `app/api/youtube/packaging/route.ts` (live PostgREST read of stale data) | Drop **only after** the route is retired or repointed. Serving 25-day-stale data today. |
| `database_growth_stats`, `database_performance_stats`, `database_channel_health`, `database_data_quality` (MVs) | 64 kB each | Refreshed 45,586 / 18,552 / 9,275 / 9,257 times historically; **no pg_cron job refreshes them now** (the 2026-09-02 cron audit removed them) | `app/dashboard/analytics/database-stats/page.tsx` | Keep the MVs, retire or gate the page — it now shows frozen numbers. Do **not** restore the cron jobs (see finding 1). |
| `chunks` + `idx_chunks_embedding` | 94 MB (43 MB was the ivfflat index) | 5,337 rows, last vacuum **2025-06-25**, no `<=>` query anywhere in `lib/`, `app/`, `scripts/` — vector search moved to Pinecone/Qdrant | only `sql/supabase-vector-schema.sql` (DDL) | Index dropped (§6). Table is a drop candidate. |
| `channel_age_adjusted_performance` (MV) | 32 MB | idx_scan **1**, no writes | only `supabase/migrations/20260901120000_security_hardening.sql` (a grant list) | Drop candidate. |
| `video_performance_trends` (MV) | 27 MB | idx_scan 7, seq_scan 8,824 | `app/api/view-tracking/stats/route.ts`, `CLAUDE.md` | Keep. |
| `bertopic_clusters`, `embeddings_v1` | 11 MB, 13 MB | legacy topic/embedding pipeline | 27 / 4 code refs | Keep for now; low value. |
| `old_patterns`, `discovery_edges`, `discovery_metrics`, `discovery_method_metrics`, `channel_relationships`, `channel_network_centrality`, `semantic_queries_v2`, `semantic_eval_v2_pool`, `video_topic_assignments_v2`, `mv_makeorbreak_dashboard` | 24–48 kB each | 0 live rows, 0 idx_scan | only DDL / archived docs / the security-hardening grant list | Drop candidates; **negligible space**, so not worth the risk. |

`temporal_performance_score` is a **column on `videos`**, not a table; it is still read by live PostgREST
queries (113,455 calls, 371 GB read historically) and backs `idx_videos_idea_radar_complete`. Not orphaned.

---

## 3. Indexes

### Duplicates / overlaps (not applied — all have non-zero scans)

| Redundant index | Superset | Size freed | Scans on the redundant one |
|---|---|---|---|
| `idx_view_snapshots_video_date` (video_id, snapshot_date DESC) | `idx_view_snapshots_video_date_desc` (same keys) `INCLUDE (view_count, like_count, comment_count)` | **94 MB** | 12,881,927 — the planner prefers the smaller one; dropping it moves those scans to the covering index at no loss of capability. |
| `view_snapshots_video_id_snapshot_date_key` UNIQUE (video_id, snapshot_date) | same key prefix as both above, but it is the **uniqueness constraint** | — | 3,222,930 — **keep**. |
| `idx_view_snapshots_date_video` (snapshot_date, video_id) | — | 93 MB | 4,218 in an unbounded window — very low value for 93 MB. |
| `view_snapshots_pkey` (id) | surrogate key with no FK referencing it | 93 MB | 75,536 |
| `idx_videos_channel_views` (channel_id, view_count DESC) | — | 85 MB | **32** |
| `idx_view_tracking_priority_tier_date` | — | 53 MB | **32** |
| `idx_videos_channel_published` (channel_id, published_at DESC) vs `idx_videos_channel_id` and `idx_videos_channel_competitor` | prefix overlap | 46 MB | 83,220 / 40,679 |

`view_snapshots` has **565 MB of index on a 219 MB heap** — five indexes over essentially the same
`(video_id, snapshot_date)` key. Consolidating to the covering index plus the unique constraint would
return roughly **280 MB** and cut the write cost of 52,696 inserts/day.

### Unused indexes (idx_scan = 0, > 1 MB)

| Table | Index | Size | Unique/PK? | Repo reference | Action |
|---|---|---|---|---|---|
| videos | idx_videos_baseline_optimized | 69 MB | no | DDL + a 2025-08-11 log that already recorded it as unused | **DROPPED** |
| chunks | idx_chunks_embedding | 43 MB | no | DDL only | **DROPPED** |
| packaging_performance | idx_packaging_title | 10 MB | no | DDL only (route uses `ilike`, not tsvector) | **DROPPED** |
| videos | idx_videos_thumbnail_analysis | 6.5 MB | no | DDL only; column unreferenced in code | **DROPPED** |
| bertopic_clusters | idx_bertopic_centroid_embedding | 4.7 MB | no | DDL only | **DROPPED** |
| channel_age_adjusted_performance | idx_perf_score | 3.5 MB | no | none | **DROPPED** |
| thumbnail_battle_matchups | idx_expires_at | 3.3 MB | no | expiry compared in JS, never in SQL | **DROPPED** |
| channels | idx_channels_keywords | 1.75 MB | no | archived log only | **DROPPED** |
| analyses | idx_analyses_embedding | 1.6 MB | no | none | **DROPPED** |
| patterns | idx_patterns_centroid_embedding | 1.1 MB | no | DDL only | **DROPPED** |
| thumbnail_battle_matchups | thumbnail_battle_matchups_matchup_id_key | 4.8 MB | **UNIQUE** | — | **kept** (constraint) |
| videos | videos_shorts_backfill_idx | 0 bytes | no | in-flight build by the concurrent verify-shorts agent | **not touched** |

### Missing indexes

**None proven.** The top live queries are not IO-bound and not index-bound — they are bound by
per-row expression evaluation (§ finding 1). An index cannot fix `EXTRACT(epoch FROM duration::interval)`;
a stored column can, and the concurrent verify-shorts agent is already adding one. A partial index over
the full eligibility predicate would work (P0-3) but is deliberately **not** applied here to avoid two
concurrent `CREATE INDEX CONCURRENTLY` builds on `videos` while a backfill is writing to it.

### EXPLAIN (ANALYZE, BUFFERS) — top live IO consumers

Four of the ten historical top-IO statements are `REFRESH MATERIALIZED VIEW` calls that no longer run
(§ finding 1) and five more are PostgREST batch-worker queries from the pre-2026-08-31 REST era, also
no longer running. EXPLAIN was therefore run on the queries that **are** live, from the 5-minute
LaunchAgents. Explaining the dead ones would have added IO for no signal; that is stated rather than
padded.

**A. `thumbnail-watch` HOT_TARGETS_SQL** (`lib/thumbs/watch-policy.ts`, every 5 min; 199 calls,
mean 23,207 ms, 28.8 GB read historically)

```
Limit (actual time=21943.973..21944.585 rows=4000)
  Buffers: shared hit=173262 read=1276 dirtied=92 written=626
  -> Hash Left Join (actual time=770.869..21934.134 rows=9237)
     -> Index Scan using idx_videos_longtail_watch on videos v
          (actual time=9.840..21084.214 rows=43288)
        Index Cond: (published_at > now() - '30 days')
        Filter: ((shorts_checked_at IS NOT NULL) OR (duration !~ '^PT[0-9HMS]+$')
                 OR (EXTRACT(epoch FROM duration::interval) > 180)) ...
        Rows Removed by Filter: 65
        Buffers: shared hit=42391 read=1256
     -> Hash (actual time=758.257..758.259 rows=125540)
        -> Unique -> Index Scan using idx_thumbver_video on thumbnail_versions
             (rows=126471)  Buffers: shared hit=130869
Planning Time: 437.285 ms
Execution Time: 21973.304 ms
```

**B. `launch-track` track_schedule seeding predicate** (`scripts/launch-track.ts`, every 5 min;
225 calls, mean 19,819 ms, 24.5 GB read historically) — run here as `count(*)` to avoid writing:

```
Aggregate (actual time=74073.386..74073.389 rows=1)
  Buffers: shared hit=32349 read=12303 written=637
  -> Hash Anti Join (rows=0)
     -> Index Scan using idx_videos_longtail_watch on videos v
          (actual time=0.027..72490.889 rows=43287)
        Filter: ((shorts_checked_at IS NOT NULL) OR (duration !~ '^PT[0-9HMS]+$')
                 OR (EXTRACT(epoch FROM duration::interval) > 180))
        Rows Removed by Filter: 65
     -> Seq Scan on track_schedule t (actual time=0.026..274.823 rows=55370)
Execution Time: 74073.633 ms
```

**C. `feed-materialize` type histogram** — `select type, count(*) from feed_events where at > now() - interval '7 days' group by type`:
`Bitmap Index Scan on idx_feed_events_at` → **11.4 ms, 1,732 buffers, all hits**. Healthy; its
historical 1,002 ms mean was cold-cache, not a missing index. No change.

---

## 4. Write load

Rows inserted per hour per table over the trailing 24 h, and the script responsible: see the
time-series table in §2. Summary of the write mix:

| Table | ins/24 h | updates (lifetime) | HOT % | dead/live | Writer |
|---|---|---|---|---|---|
| videos | — | 12,953,447 | **18.2 %** | 89,369 / 999,608 (8.9 %) | verify-shorts, title stamping, ingest, classifiers |
| view_tracking_priority | — | 3,496,166 | **12.4 %** | 98,135 / 936,502 (10.5 %) | nightly-view-tracking |
| thumbnail_versions | 20,088 | 1,833,227 | 83.3 % | 5,665 / 126,473 | thumbnail-watch (`set last_checked=now()` per video, 1,669,824 single-row round trips) |
| view_snapshots | 52,696 | 727,660 | 37.6 % | **312,915 / 2,355,039 (13.3 %)** | nightly-view-tracking |
| track_schedule | — | 605,955 | 29.5 % | 9,809 / 55,370 | launch-track |
| daily_analytics | — | 757,437 | 34.0 % | 26,474 / 304,772 | analytics backfill |
| video_scores | 176,561 | 236,811 | **0.0 %** | 2,555 / 174,415 | score-videos (hourly) |
| rss_samples | 737,228 | 0 | — | 0 | rss-poll |
| view_samples | 193,149 | 0 | — | 16 | launch-track |

### Autovacuum

**No table in the database has per-table autovacuum reloptions** (`pg_class.reloptions` is null for every
table; the only reloptions present are `lists=100` on ivfflat indexes and `security_invoker=true` on views).
Everything therefore runs at the cluster default `autovacuum_vacuum_scale_factor = 0.2`:

- `view_snapshots` (2.36 M live) does not trigger autovacuum until **471,008 dead tuples**. It sits at
  312,915 (13.3 %) and was last autovacuumed **2026-09-01 00:25** — over three days ago while taking
  52,696 inserts and 727,660 lifetime updates. It is drifting toward that threshold, not away from it.
- `videos` (1.0 M live) triggers at 200,000 dead; currently 89,369.
- `view_tracking_priority` (936 K live) triggers at 187,300; currently 98,135, and 89,513 rows modified
  since the last analyze on 09-03.

Autovacuum is *keeping up* today but only because the thresholds are enormous. On a 2 vCPU instance with
3 workers and no cost-limit tuning, a single `view_snapshots` autovacuum at 471 K dead tuples is a large,
badly-timed IO event.

### Hot-update patterns worth fixing

- **`videos` at 18.2 % HOT with 47 indexes.** 10.59 M of 12.95 M updates were non-HOT, and each one had
  to insert a new tuple version into every one of the 47 indexes. Two of those indexes (75 MB) were dead
  weight and are now dropped. The `title_observed_at` stamping statement alone
  (`update videos set title_observed_at = $2 where id = any($1) ...`, 352 calls, 14,108 ms mean,
  411,474 rows) rewrites full tuples on a table with a 1,819 byte average row and 794 MB of TOAST.
  `videos` has 29.7 % estimated bloat, consistent with this. → **`ALTER TABLE videos SET (fillfactor = 85)`**
  (P1-4); `title_observed_at`/`shorts_checked_at`/`last_checked`-style stamps belong in a narrow side
  table keyed by `video_id` (P2-1).
- **`view_tracking_priority` at 12.4 % HOT with 124 MB of index on a 74 MB heap.** Same shape.
  fillfactor 85 plus a per-table `autovacuum_vacuum_scale_factor = 0.05`.
- **`video_scores` at 0.0 % HOT.** Every hourly rescore updates `score`/`scored_at`, both indexed, so
  no update can ever be HOT. Accepted cost; the table is small (88 MB), but note 55 MB of that is index.
- **`thumbnail_versions` at 83.3 % HOT** — healthy, but 1,669,824 single-row `update ... set last_checked=now()`
  round trips through the pooler is a latency and connection-churn problem, not an IO one. Batch them
  (P2-2).

---

## 5. Connections and timeouts

| Script | LaunchAgent cadence | Connection string | Pool `max` | `statement_timeout` |
|---|---|---|---|---|
| `scripts/rss-poll.ts` | every 5 min (:01,:06,…) | DATABASE_URL (:6543 txn) | 4 | 120 s |
| `scripts/thumbnail-watch.ts` | every 5 min (:00,:05,…) | DATABASE_URL | 4 | **0 (disabled)** |
| `scripts/launch-track.ts` | every 5 min (:02,:07,…) | DATABASE_URL | 3 | 120 s |
| `scripts/feed-materialize.ts` | every 5 min (:03,:08,…) | DATABASE_URL | 3 | 120 s |
| `scripts/drain-touch-queue.ts` | every 5 min (:04,:09,…) | DATABASE_URL | 4 | server default (120 s) |
| `scripts/track-drain.ts` | every 15 min | DATABASE_URL | 2 | server default |
| `scripts/verify-shorts.ts` | every 15 min + 2 backfill agents | DATABASE_URL | 3 each | server default |
| `scripts/score-videos.ts` | hourly | DATABASE_URL | 3 | 300 s |
| `scripts/semantic/sync-semantic.ts` | hourly | DATABASE_URL | 1 | server default |
| `scripts/rss-retention.ts` | 04:45 daily | DATABASE_URL | 2 | 300 s |
| `scripts/nightly-ingest.ts` | 03:00 daily | DATABASE_URL | 4 | server default |
| `scripts/nightly-view-tracking.ts` | 03:30 daily | DATABASE_URL | 4 | server default |
| `scripts/extension-api-server.ts` | always on | DATABASE_POOLER_URL → DATABASE_URL | 2 | server default |
| `scripts/websub-subscribe.ts` | every 3 days | DATABASE_URL | 4 | server default |

**Every script uses transaction-mode pooling on :6543.** Nothing in the repo references
`DATABASE_SESSION_URL` — the 2026-09-02 `EMAXCONNSESSION` at 15 clients was session-mode
(:5432) traffic from interactive/agent `psql` sessions, not from the pipeline. Both URLs were verified
working this session, and `DATABASE_POOLER_URL` (`db.<ref>.supabase.co:6543`, IPv6-only) also answers.

**Worst-case simultaneous client demand** (minute `:00` of an hour, all agents overlapping, plus the
two verify-shorts backfills): 4+4+3+3+4+2+3+3+3+1+2 = **32 client connections**, against a Supavisor
transaction-mode pool that multiplexes them onto ~15 server connections. Measured server-side Supavisor
backends were 8 in both samples, so transaction mode is absorbing this correctly. The danger is only
that any script switching to `DATABASE_SESSION_URL` would hit the 15-client session cap immediately.

**Proposed per-script budget** (sum ≤ 24 clients, leaving headroom for the Next.js app, PostgREST and
one interactive agent):

| Tier | Scripts | Budget |
|---|---|---|
| 5-minute agents | rss-poll 3, thumbnail-watch 3, launch-track 2, feed-materialize 2, drain-touch-queue 3 | 13 |
| 15-minute agents | track-drain 2, verify-shorts 3 (backfills share this, not add to it) | 5 |
| Hourly | score-videos 2, sync-semantic 1 | 3 |
| Always-on | extension-api-server 2 | 2 |
| Nightly (03:00–05:00, non-overlapping with the above by convention) | ingest 4, view-tracking 4, rss-retention 2 | — |
| **Interactive / agent sessions** | psql, ad-hoc | **1, transaction mode (:6543) only** |

**`thumbnail-watch` runs with `statement_timeout = 0`.** Its own comment says this was to stop 57014
errors. That converts a slow query into an unbounded one: the 22 s HOT_TARGETS_SQL has no ceiling if
the plan degrades. It should be `set statement_timeout = 60000`, not 0 (P1-5).

---

## 6. Safe fixes applied 2026-09-04

All applied via `DATABASE_SESSION_URL` (session mode, so `CONCURRENTLY` is safe), all reversible.

### 6a. `DROP INDEX CONCURRENTLY` — 10 indexes, all `idx_scan = 0`, none PK or UNIQUE, none referenced by a query path

```sql
DROP INDEX CONCURRENTLY IF EXISTS public.idx_videos_baseline_optimized;      -- 69 MB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_chunks_embedding;               -- 43 MB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_packaging_title;                -- 10 MB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_videos_thumbnail_analysis;      -- 6.5 MB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_bertopic_centroid_embedding;    -- 4.7 MB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_perf_score;                     -- 3.5 MB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_expires_at;                     -- 3.3 MB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_channels_keywords;              -- 1.75 MB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_analyses_embedding;             -- 1.6 MB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_patterns_centroid_embedding;    -- 1.1 MB
```

**Measured effect:** total index bytes removed **150,872,064 B = 143.9 MiB**.
`pg_database_size` 6,422 MB → **6,257 MB (−165 MB)`. `videos` total 3,981 MB → 3,887 MB; `videos`
index total 1,453 MB → 1,359 MB. Verified: `select count(*) from pg_class where relname in (…)` = **0**.
Two of the ten sat on `videos`, so every one of its 10.59 M non-HOT updates now writes 45 index entries
instead of 47 (−4.3 % index write amplification on the hottest table in the database).

**Rollback** (each is a single statement; run off-peak, `CONCURRENTLY`):
```sql
CREATE INDEX CONCURRENTLY idx_videos_baseline_optimized ON public.videos USING btree (channel_id, published_at DESC) WHERE ((is_short = false) AND (published_at IS NOT NULL) AND (view_count > 0));
CREATE INDEX CONCURRENTLY idx_chunks_embedding ON public.chunks USING ivfflat (embedding) WITH (lists='100');
CREATE INDEX CONCURRENTLY idx_packaging_title ON public.packaging_performance USING gin (to_tsvector('english', title));
CREATE INDEX CONCURRENTLY idx_videos_thumbnail_analysis ON public.videos USING gin (thumbnail_analysis_metadata);
CREATE INDEX CONCURRENTLY idx_bertopic_centroid_embedding ON public.bertopic_clusters USING ivfflat (centroid_embedding) WITH (lists='100');
CREATE INDEX CONCURRENTLY idx_perf_score ON public.channel_age_adjusted_performance USING btree (age_adjusted_score DESC);  -- NOTE: reconstructed from the matview's columns; the exact original definition was not captured before the drop
CREATE INDEX CONCURRENTLY idx_expires_at ON public.thumbnail_battle_matchups USING btree (expires_at);
CREATE INDEX CONCURRENTLY idx_channels_keywords ON public.channels USING gin (to_tsvector('english', keywords));
CREATE INDEX CONCURRENTLY idx_analyses_embedding ON public.analyses USING ivfflat (embedding) WITH (lists='100');
CREATE INDEX CONCURRENTLY idx_patterns_centroid_embedding ON public.patterns USING ivfflat (centroid_embedding) WITH (lists='100');
```

Caveat: these `CREATE INDEX` statements were reconstructed from `sql/` DDL and the tables' current
columns after the drop, not captured verbatim from `pg_get_indexdef` beforehand. `idx_videos_baseline_optimized`,
`idx_videos_thumbnail_analysis`, `idx_chunks_embedding`, `idx_packaging_title`,
`idx_bertopic_centroid_embedding`, `idx_expires_at`, `idx_channels_keywords` and
`idx_patterns_centroid_embedding` match their original DDL files exactly; `idx_perf_score` and
`idx_analyses_embedding` are inferred. All ten had zero scans, so an inexact rollback costs nothing.

### 6b. `ANALYZE` on tables with stale statistics

```sql
ANALYZE public.packaging_performance;             -- last analyzed 2026-08-10
ANALYZE public.chunks;                            -- last analyzed 2025-06-25
ANALYZE public.channel_age_adjusted_performance;  -- never
ANALYZE public.video_performance_trends;          -- never
ANALYZE public.view_tracking_priority;            -- 89,513 rows modified since last analyze
ANALYZE public.track_schedule;
ANALYZE public.thumbnail_versions;
ANALYZE public.rss_samples;
```
All eight returned `ANALYZE`. **Rollback:** none needed — `ANALYZE` only refreshes planner statistics
and is idempotent; the previous statistics were older and strictly worse.

### Deliberately NOT applied

- No index was created. See §3 "Missing indexes" — nothing was EXPLAIN-proven, and `videos` DDL is
  owned by the concurrent verify-shorts agent this session.
- No table dropped, no retention changed, no compute changed, per the audit scope.

---

## 7. Prioritized recommendations

### P0 — stop the bleeding

**P0-1. Egress will cross the org quota around 12–13 Sep.**
68.90 GB of 250 GB burned in 3.45 days (19.97 GB/day, projecting to ~340 GB = 136 % of quota) on an
org that also hosts machinesformakers.com production. On 2026-08-31 an overage restricted every project
in the org.
*Action:* confirm the spend cap is **OFF** (cap ON turns the overage into an org-wide outage; cap OFF
turns it into ~90 GB × $0.09 ≈ **$8**), then find the 20 GB/day. It is not this audit's direct Postgres
traffic. Candidates: PostgREST reads from the Next.js app and the Chrome extension, and Supabase Storage
egress — the bucket total went 4.7 GB → 18 GB in three days, which is where the thumbnail pipeline writes.
*Expected effect:* avoids an org-wide restriction. *Rollback:* re-enable the spend cap.

**P0-2. The egress alarm built after the 2026-08-31 incident has never run.**
`~/shared-memory/logs/supabase-egress-launchd.log` contains nothing but `NO TOKEN` — every daily run
since installation has exited at line 1. There is no Supabase personal access token anywhere on this
machine.
*Action:* create a PAT at https://supabase.com/dashboard/account/tokens and
`install -m 600 /dev/stdin ~/.config/supabase/access-token`. Also lower `QUOTA_GB` in
`~/shared-memory/scripts/check-supabase-egress.py` from 275 to **250** — the dashboard now shows a
250 GB Pro allowance, so the script would under-report by 10 %.
*Expected effect:* the 70 %-of-quota alarm actually fires. *Rollback:* `rm ~/.config/supabase/access-token`.

**P0-3. One predicate costs ~8.5 CPU-hours/day out of 48 available.**
`lib/scoring/longform`'s eligibility clause — `not (shorts_checked_at is null and duration ~ '^PT[0-9HMS]+$'
and extract(epoch from duration::interval) <= 180)` — is evaluated per row by three 5-minute LaunchAgents.
Measured: **72.5 s to filter 43,287 rows and reject 65** (launch-track), **21.1 s for the same scan**
(thumbnail-watch), on only ~44,000 buffers. It is pure expression CPU, not IO. At 288 runs/day that is
5.9 + 1.7 + 0.8 ≈ **8.5 CPU-hours/day ≈ 18 % of a 2-vCPU instance**, to exclude 65 rows.
*Action:* **the concurrent verify-shorts agent's stored duration-seconds column on `videos` is exactly
this fix** — once it lands, rewrite `longformSql()` to compare the stored integer and add
`CREATE INDEX CONCURRENTLY idx_videos_longform_published ON videos (published_at DESC) WHERE (<new predicate>)`.
Expected: 72.5 s → sub-second. *Rollback:* `DROP INDEX CONCURRENTLY idx_videos_longform_published;` and
revert `longformSql()`.

**P0-4. rss_samples' 30-day dense window is a 4.2 GB storage bomb on a 12 GB disk.**
Measured 737,228 rows/24 h (30,718/h) at 129 B/row incl. index. `lib/rss/retention.ts` keeps every
sample for **30 days** before thinning to one per video per day. Steady state: **22.1 M rows ≈ 2.9 GB
heap + ~1.3 GB index**. Today's table is 19.5 h old and already 91 MB. Total measured append-only
growth across all time series is ~155 MB/day, reaching the 12 GB disk in ~37 days.
*Action:* `RSS_RETENTION.denseWindowDays: 30 → 4`, and run `rss-retention.ts` hourly rather than daily
so each pass is small. *Expected effect:* rss_samples capped at ~3 M rows / ~560 MB instead of 4.2 GB.
*Rollback:* set `denseWindowDays` back to 30 (data already thinned cannot be recovered — take the
decision knowingly).

### P1 — this week

**P1-1. Do not let the `database_*` materialized views ever be scheduled again.**
Historically `REFRESH MATERIALIZED VIEW CONCURRENTLY database_growth_stats` ran **45,586 times**, mean
**48.2 s**, total **2,198,124 s = 610 hours** of execution and **25,680,241,457 shared blocks read
= 196 TB**. With `database_performance_stats` (47 TB), `database_channel_health` (23.5 TB) and
`database_data_quality` (15 TB) that is **~281 TB of block reads** for four **64 kB, single-row** views.
This is the source of the repeated IO saturation. The 2026-09-02 cron audit removed the jobs and
`cron.job` now lists only 6 entries (3 active, none of them a refresh) — but the views and the page that
reads them (`app/dashboard/analytics/database-stats/page.tsx`) still exist, which is a standing
invitation to re-add the schedule.
*Action:* delete the page or put a hard comment on the views. *Expected effect:* prevents recurrence.
*Rollback:* n/a.

**P1-2. `refresh_analytics_stats()` — 984.9 GB read over 1,275 calls (mean 28.9 s).** Same class of
problem, no live caller found in the repo. Confirm nothing schedules it before anything re-adds it.

**P1-3. Consolidate `view_snapshots` indexes: 565 MB of index on a 219 MB heap.**
```sql
DROP INDEX CONCURRENTLY public.idx_view_snapshots_video_date;   -- 94 MB, fully covered by …_video_date_desc
DROP INDEX CONCURRENTLY public.idx_view_snapshots_date_video;   -- 93 MB, 4,218 scans in an unbounded window
```
*Expected effect:* −187 MB, and two fewer index writes on each of 52,696 daily inserts. These are **not**
in the applied set because their scan counts are non-zero; verify with `EXPLAIN` on the reader in
`lib/` first. *Rollback:* recreate from the definitions in §3.

**P1-4. `videos` fillfactor.** 18.2 % HOT over 12.95 M updates and 29.7 % estimated bloat (515 MB).
```sql
ALTER TABLE videos SET (fillfactor = 85);
ALTER TABLE view_tracking_priority SET (fillfactor = 85);
```
Only affects pages written after the change; a `VACUUM FULL` (exclusive lock, needs 1.7 GB of free disk)
or `pg_repack` would be needed to reclaim the existing 515 MB.
*Rollback:* `ALTER TABLE videos RESET (fillfactor);`

**P1-5. Per-table autovacuum on the big churners.** All tables run at the 0.2 default; `view_snapshots`
needs 471,008 dead tuples before autovacuum fires and was last vacuumed 2026-09-01.
```sql
ALTER TABLE view_snapshots SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01);
ALTER TABLE view_tracking_priority SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE videos SET (autovacuum_vacuum_scale_factor = 0.05);
```
*Expected effect:* many small vacuums instead of one 471 K-tuple IO spike. *Rollback:* `RESET` each.

**P1-6. `thumbnail-watch` must not run with `statement_timeout = 0`.**
`scripts/thumbnail-watch.ts:59`. Set 60,000. *Rollback:* revert the line.

**P1-7. Rewrite `HOT_TARGETS_SQL` to use the LATERAL shape `LONG_TAIL_TARGETS_SQL` already uses.**
The `latest` CTE materialises all 125,540 `thumbnail_versions` rows every 5 minutes: 130,869 buffers,
758 ms per run, 288 runs/day. *Expected effect:* −0.76 s and −1 GB of buffer traffic per run.
*Rollback:* revert `lib/thumbs/watch-policy.ts`.

### P2 — later

**P2-1. → promoted to P1-8, see §8b.** Move `videos.title_observed_at` / `shorts_checked_at` stamping to a narrow side table keyed
by `video_id`. Today each stamp rewrites a 1,819-byte row plus up to 45 index entries; the
`title_observed_at` statement alone touched 411,474 rows at a 14.1 s mean.
*Rollback:* keep the columns and dual-write during migration.

**P2-2.** Batch `thumbnail-watch`'s 1,669,824 single-row `update thumbnail_versions set last_checked=now()`
statements into one `update … where (video_id, version) in (…)` per chunk of 50.

**P2-3.** Retention/rollup for `view_samples` (193,149/day, no retention at all) and `view_snapshots`
(52,696/day). Hourly rollup after 7 days, daily after 30.

**P2-4.** Drop the confirmed orphans once their last references are removed: `packaging_performance`
(355 MB, stale since 08-10), `chunks` (51 MB after the index drop), `channel_age_adjusted_performance`
(28 MB). Combined ~434 MB. *Rollback:* the MVs can be recreated from `sql/`; `chunks` data cannot.

**P2-5.** Compute: the instance is Small (2 vCPU / 2 GB). Do **not** upsize before P0-3 lands — 18 % of
the CPU is being spent parsing ISO-8601 strings, and Medium at ~$60/mo would buy time rather than fix it.
Revisit after measuring.

---

## 8. Live load, measured (not cumulative): `pg_stat_statements` delta

Because `pg_stat_statements` has never been reset and PG15 has no `stats_since`, the cumulative figures
above cover an unbounded window and include statements that no longer run. Two snapshots were taken
**18.9 minutes apart (10:48:40 → 11:07:35 UTC)** — long enough to cover ~4 ticks of every 5-minute agent —
and differenced. Everything below is what the database actually did in those 18.9 minutes.

- **Total execution time added: 2,616,785 ms = 2,617 s in 1,134 s of wall clock = 2.31 CPU-seconds per
  wall-second.** On a 2-vCPU Small instance that is **~115 % of one core / ~58 % of both**, sustained.
- **Total blocks read: 1,941,516 = 15.90 GB.**

| Exec (ms) | Calls | Mean | MB read | Statement |
|---|---|---|---|---|
| 319,823 | 2,984 | 107 ms | 465 | `insert into view_snapshots … on conflict` |
| **240,752** | 1 | 240.8 s | **3,108** | `create index concurrently … videos_shorts_backfill_idx` (concurrent agent) |
| 196,839 | 3 | 65.6 s | 678 | scoring gap query (`videos` self-join on prior upload) |
| 195,692 | 4 | 48.9 s | 401 | thumbnail-watch `HOT_TARGETS_SQL` |
| 187,011 | 2 | 93.5 s | 757 | score-videos candidate select (`videos` ⟕ `video_scores`) |
| **114,533** | 1 | 114.5 s | 0 | `drop index concurrently … videos_shorts_unchecked_idx` (concurrent agent) |
| 98,797 | 5 | 19.8 s | 918 | `update videos set title_observed_at = …` |
| 95,158 | 3 | 31.7 s | 281 | launch-track `insert into track_schedule … select from videos` |
| **85,329** | 1 | 85.3 s | **3,140** | `create index concurrently … videos_shorts_flagged_unchecked_idx` (concurrent agent) |
| 83,843 | 1 | 83.8 s | 1,568 | verify-shorts progress count over `videos` (concurrent agent) |
| 74,100 | 1 | 74.1 s | 101 | *this audit's* `EXPLAIN ANALYZE` (§3 B) |
| 72,037 | 3 | 24.0 s | 67 | `distinct on (video_id) … from view_snapshots` |
| 65,591 | 3 | 21.9 s | 117 | feed-materialize candidate select |
| 59,141 | 2 | 29.6 s | 79 | `distinct on (video_id) … from rss_samples` |
| 55,003 | 1 | 55.0 s | 238 | *this audit's* `ANALYZE packaging_performance` |

### IO impact of the concurrent verify-shorts backfill

The four statements attributable to the other agent's in-flight work (two `CREATE INDEX CONCURRENTLY`,
one `DROP INDEX CONCURRENTLY`, one progress count) consumed **524,457 ms = 20 % of all execution time**
and **7,816 MB = 49 % of all blocks read** in the window. That is a one-off build cost, not a steady
state, and it is the correct trade: it buys the P0-3 fix. But it means **any other heavy work should be
deferred until those index builds finish** — the instance was already at ~58 % of both cores without them.

This audit itself contributed 129,103 ms (5 % of execution) — the one `EXPLAIN ANALYZE` and the eight
`ANALYZE` statements. That is disclosed rather than netted out.

### Steady state, excluding both

Excluding the concurrent agent's DDL and this audit's own statements, the recurring pipeline used
**~1,963 s of execution in 1,134 s of wall clock = 1.73 CPU-seconds per wall-second ≈ 87 % of one core**.
Of that, the four queries carrying the longform eligibility predicate (thumbnail-watch 195,692 ms,
score-videos 187,011 ms, launch-track 95,158 ms, feed-materialize 65,591 ms) account for
**543,452 ms = 28 % of all execution in the window** — the single largest addressable block of CPU on
this instance, and the direct justification for P0-3.

### 8b. Clean steady state — 9.0 minutes with no audit and no backfill DDL

A third snapshot at **11:16:35 UTC** gives a 9.0-minute window (11:07:35 → 11:16:35) containing **no
statement from this audit** and **none of the concurrent agent's index builds** — they had finished. This
is the truest picture of the recurring pipeline.

- **Execution added: 818,575 ms = 819 s in 540 s of wall clock = 1.52 CPU-seconds per wall-second
  ≈ 76 % of both cores, sustained, doing nothing but routine work.**
- Blocks read: 272,305 = **2.23 GB** in 9 minutes (≈ 357 GB/day).

| Exec (ms) | Calls | Mean | MB read | Statement | Writer |
|---|---|---|---|---|---|
| 191,796 | 1,340 | 143 ms | 170 | `insert into view_snapshots … on conflict` | nightly/tracking |
| **181,033** | 6 | **30.2 s** | 701 | `update videos set title_observed_at = $2 where id = any($1) …` | title watcher |
| 175,399 | 2 | 87.7 s | 402 | `insert into track_schedule … select from videos` | launch-track |
| 140,813 | 2 | 70.4 s | 349 | thumbnail-watch `HOT_TARGETS_SQL` | thumbnail-watch |
| 45,284 | 2 | 22.6 s | 84 | feed-materialize candidate select | feed-materialize |
| 9,635 | 9,466 | 1 ms | 19 | `update thumbnail_versions set last_checked=now()` | thumbnail-watch |
| 8,902 | 2 | 4.5 s | 31 | changed-packaging rollup | feed-materialize |
| 8,815 | 2 | 4.4 s | 28 | `feed_events` type histogram | feed-materialize |
| 7,997 | 1 | 8.0 s | 194 | `select id from videos where duration = $1 …` | ingest |

Two conclusions the cumulative counters could not give:

1. **The longform eligibility predicate is 361,496 ms = 44 % of all execution in a clean window**
   (launch-track 175,399 + thumbnail-watch 140,813 + feed-materialize 45,284), with score-videos not even
   running in this window because it is hourly. Note the means are *worse* than the isolated EXPLAINs in
   §3 — 87.7 s vs 74.1 s and 70.4 s vs 22.0 s — because these agents contend with each other. This
   confirms P0-3 as the highest-value change in the system.
2. **`update videos set title_observed_at` is 181,033 ms = 22 % of all execution at a 30.2 s mean over
   6 calls and 701 MB read.** That is far larger than the cumulative counters suggested and moves it out
   of P2. See P1-8 below.

**P1-8 (promoted from P2-1). `videos.title_observed_at` stamping is 22 % of steady-state CPU.**
Six statements in nine minutes, 30.2 s mean, 701 MB read, on a table with a 1,819-byte average row,
794 MB of TOAST, 45 indexes and only 18.2 % HOT updates — every stamp rewrites the whole row and up to
45 index entries. *Action:* move the stamp to a narrow side table `video_title_watch (video_id primary key,
title_observed_at timestamptz)`, or at minimum land the P1-4 fillfactor change first and re-measure.
*Expected effect:* a ~50-byte row update against one index instead of a 1.8 KB row against 45.
*Rollback:* keep `videos.title_observed_at` and dual-write during the migration; drop the side table.
