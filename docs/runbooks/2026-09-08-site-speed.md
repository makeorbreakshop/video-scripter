# Site speed work — 2026-09-08

The fixes behind `~/shared-memory/knowledge/projects/video-scripter/2026-09-08-site-speed-analysis.md`.
Everything here is measured, in shared blocks (read + hit) rather than seconds: this instance has
512 MB of shared_buffers against ~10 GB of data, so wall time is mostly a function of what
happened to be cached and the same page can differ 5x with no code change.

## The benchmark

`npx tsx scripts/bench-pages.ts --out docs/benchmarks/pages-<date>-<label> --label <label>`

Starts its own `next dev` on a free port with `BENCH=1` (which makes `lib/app/cached.ts` call the
uncached functions directly, so the numbers are the reads and not an `unstable_cache` hit),
points it at the `channelsmith_app` role from `~/.channelsmith_app_url` so the
`pg_stat_statements` delta contains only the app's own statements and not the pipeline's, and
loads each URL three times — one discarded priming run for dev-mode compilation, then two
measured ones.

## Before / after

See `docs/benchmarks/pages-2026-09-08-after.md`. Summary:

| page | before | after | change |
|---|---:|---:|---:|
| channel page (1,745 videos) | 10,368 | 3,996 | −61% |
| channel page (245 videos) | 2,659 | 1,367 | −49% |
| video page (heaviest) | 4,843 | 1,591 | −67% |
| video page (lightest) | 1,320 | 762 | −42% |
| /app/channels | 92,630 | 90,594 | −2% |
| feed (all four tabs) | ~20,500 | ~20,400 | ~0% |

The video-page numbers are with the observation cache populated for those three channels only.
The rest of the corpus gets the same reduction after tonight's backfill.

## What changed

### 1. Priors come from `video_obs_cache`, not three range scans

`lib/scoring/prior-load.ts` `loadRecords` rebuilt every prior's merged observation record from a
union of `view_snapshots`, `view_samples` and `rss_samples` — on every hourly scoring run and
every video-page render. 118M shared blocks off disk in four days.

`video_obs_cache` stores the output of that exact query, gzipped, 862 bytes a row (1,285 on the
denser channels). A prior is now one index probe on a narrow table.

- Exact by construction: the refresher runs `OBSERVATION_RECORDS_SQL` itself, so a hit is the
  same bytes rather than a reimplementation that could drift.
- A video with unincorporated readings is in `series_dirty`, and the read path anti-joins against
  it, so such a video falls back to the raw union and is exact.
- Anything the cache cannot answer falls through unchanged, so behaviour is identical whether or
  not the backfill has run. `OBS_CACHE=0` is the kill switch.
- `scripts/score-videos.ts` logs the hit rate at the end of every run.
- Pinned by `lib/scoring/obs-cache.integration.test.ts`: 0 deviation on the priors and the
  typical curve of a real sample, and a byte comparison of every stored record.

**Why Postgres and not the R2 series file.** Both hold the same readings. But the series file is
the RAW rows (~50 KB decompressed, the scorer's filter not applied), and the scorer reads priors
in chunks of 100 ids on a pg pool it already holds: Postgres answers 100 ids in one round trip of
small rows, where R2 would be 100 separate GETs per chunk plus a merge over 5 MB of JSON — for an
hourly job over tens of thousands of priors that is the wrong shape. The R2 file stays the
chart's serving format.

### 2. SERIES_READ is not ready, and one night will not make it ready

`npx tsx scripts/series-coverage.ts`

Measured today: **0.7%** of a random sample of the 1,098,870 videos with readings has a series
file. `SERIES_READ=1` tomorrow would fall back on 99% of reads, and a fallback is an R2 round
trip *on top of* the Postgres reads it was meant to replace — every video page would get slower.

Both plists are installed, loaded, and match the repo copies
(`com.mfm.video-scripter-series-backfill` at 04:00, `com.mfm.video-scripter-export-tables` at
03:15, both last exited 0). The problem is not scheduling, it is throughput:

- the 10-minute drain writes 4,000 files in **25.7 minutes** — it overruns its own interval, and
  the `series_dirty` queue is **~40,000 and rising** (39,385 → 40,794 observed over one evening).
- the nightly `--all` pass walks all 1.1M videos at ~385 ms each, which is months, not a night.

The drain is bound by R2 PUT round trips at concurrency 8, not by the database. Raising the
concurrency and the per-run limit is the lever; that is a separate change and is **not** made
here. **Do not turn SERIES_READ on.**

### 3. The channel page's Changes count and the channel list's last upload are precomputed

Both are columns on `channel_stats` now (`packaging_change_count`, `last_upload_at`), with one
definition of the count shared by the live read and the precompute
(`lib/app/packaging-rows.ts` `changedVideoCountSql`), pinned by
`lib/app/channel-stats.integration.test.ts`.

The count is deliberately **not** in the unscoped `refreshChannelStats` statement: across 500
channels in one query that is ~8 GB of buffer traffic. `scripts/refresh-packaging-counts.ts`
walks them one at a time instead — 500 tracked channels in 5.7 minutes, measured.

**The bigger number on that page is not this one.** `/app/channels` costs 92,630 blocks and
89,120 of them are the sparkline lane's single statement (`videos ⋈ video_scores` over all 500
tracked channels, `lib/app/channel-sparklines.ts`). `listUserChannels` was 3,472. Precomputing
the sparkline series is the next obvious win and is **not** done here.

### 4. The videos diet

`description` + `metadata` + `llm_summary` average **1,233 bytes of a ~1,650-byte heap row**
(`pg_stats`, 2026-09-08) on a table whose heap is 1.73 GB over 1,098,873 rows. Three quarters of
every heap fetch on the hottest table in the database is text no page renders.

`video_text` now holds them. A mirror trigger on `videos` keeps the copy true — one place, rather
than the 176 call sites that read those columns today, and it is what makes the eventual null-out
provable rather than hopeful. `scripts/move-video-text.ts` copies in keyset batches with a
`pg_stat_activity` brake and is fully resumable; `--verify` compares the two copies row by row
(1,500 rows moved and verified today, 0 mismatches).

**Nothing is dropped or nulled.** `videos` stays authoritative, so this change alters no read.
The null-out plus `VACUUM FULL` — which is where the win actually lands, taking the heap to
roughly 500 MB — is a separate change that is **not** scheduled and should not be run until every
reader has been moved to `lib/app/video-text.ts`.

### 5. Pipeline queries

**track-drain's unscored-channel sweep** — `scripts/track-drain.ts`. Was 34,578 blocks and 24 s
every fifteen minutes. The cost came from the channels that are already CLEAN: for those the
`EXISTS` has to examine the whole catalogue before it can answer "no", and no index shortcuts an
anti-join against `video_scores`. It now examines 20 channels a run, oldest check first
(`channel_tracking.unscored_checked_at`), so every channel is still seen within a day.

    before   34,578 blocks / 24 s
    after    16,053 blocks / 1.9 s, and bounded by the candidate count rather than by how
             many channels are tracked

**Three queries were measured and deliberately NOT changed**, because they all have the same
cause and the same fix:

| statement | per call | why |
|---|---:|---|
| `launch-track` enrol insert | 28,842 blocks, 24.5 s | index scan over the 58,174 videos published in the last 30 days, fetching every 1.65 KB heap row to evaluate the shorts filter, then anti-joining `track_schedule` — and returning **0 rows**, because they are all already enrolled |
| `thumbnail-watch` lateral over videos | 11,475 blocks | same recent-window scan |
| `score-videos` due slice | 4,489 blocks | same recent-window scan |

The obvious fix is a covering index — `videos (published_at desc) include (id, channel_id,
duration, shorts_checked_at, privacy_status, view_count)` with the long-form partial predicate —
and it would work: `relallvisible` equals `relpages` on `videos`, so index-only scans are
available today. But it is ~100 MB of new index on a 512 MB buffer pool, and **step 4 fixes all
three for free by making the heap rows small**. Do the null-out first, re-measure these three,
and only add the index if the diet is not enough. The DDL, if it is needed:

```sql
create index concurrently idx_videos_recent_window
  on videos (published_at desc)
  include (id, channel_id, duration, shorts_checked_at, privacy_status, view_count)
  where coalesce(is_short, false) = false and coalesce(duration, '') <> 'P0D';
```

## Cold indexes — listed, not dropped

100 non-unique, non-primary indexes have **zero** lifetime scans, but they total only 3.6 MB and
most belong to Supabase's own auth/storage schemas. The ones worth looking at are the large,
barely-used ones (349 MB together):

```sql
-- scans in the lifetime of the stats (pg_stat_database.stats_reset is null: never reset)
drop index concurrently idx_videos_channel_views;                  -- 101 MB, 32 scans
drop index concurrently idx_view_tracking_priority_tier_date;      --  65 MB, 32 scans
drop index concurrently idx_vsh_version_scored;                    --  34 MB, 82 scans
drop index concurrently idx_videos_classified_at;                  --  28 MB, 68 scans
drop index concurrently idx_videos_competitor_metadata;            --  27 MB, 44 scans
drop index concurrently idx_videos_topic_niche;                    --  21 MB, 135 scans
drop index concurrently idx_videos_topic_domain;                   --  21 MB, 37 scans
```

`idx_video_scores_score` (27 MB, 401 scans) and `idx_videos_competitor_channel` (24 MB, 596
scans) are used, just rarely — leave them. **Nothing has been dropped.** Every one of these is
also a write cost on the hottest table in the database, so dropping the `videos` ones is worth
doing, but after a look at whether the Idea Heist routes that use the topic columns are dormant
or merely quiet.

## What runs tonight

Three one-shot / nightly jobs, none of them installed. Copy and bootstrap each:

```sh
cd /Users/brandoncullum/video-scripter-v2/video-scripter   # they run from the production checkout

# 04:45 — fill video_obs_cache for every tracked channel's prior window (~15 min). ONE-SHOT.
cp scripts/launchd/com.mfm.video-scripter-obs-cache-backfill.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.mfm.video-scripter-obs-cache-backfill.plist

# 05:05 — keep channel_stats.packaging_change_count / last_upload_at true (~6 min). NIGHTLY.
cp scripts/launchd/com.mfm.video-scripter-packaging-counts.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.mfm.video-scripter-packaging-counts.plist

# 05:30 — copy videos.description/metadata/llm_summary into video_text (~15-20 min). ONE-SHOT.
cp scripts/launchd/com.mfm.video-scripter-move-video-text.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.mfm.video-scripter-move-video-text.plist
```

They are spaced after the 04:00 series backfill so no two heavy walks overlap. Each one refuses
to start if anything has been running in Postgres for over two minutes, re-checks periodically,
and is resumable.

Remove the two one-shots after they have run:

```sh
launchctl bootout gui/$UID/com.mfm.video-scripter-obs-cache-backfill
launchctl bootout gui/$UID/com.mfm.video-scripter-move-video-text
rm ~/Library/LaunchAgents/com.mfm.video-scripter-obs-cache-backfill.plist
rm ~/Library/LaunchAgents/com.mfm.video-scripter-move-video-text.plist
```

Check them in the morning:

```sh
npx tsx scripts/series-coverage.ts          # obs-cache coverage, series coverage, queue depth
npx tsx scripts/move-video-text.ts --verify # both copies of the text agree
npx tsx scripts/bench-pages.ts --out docs/benchmarks/pages-2026-09-09-after --label after
```

## Migrations applied

All four are already applied to production and are additive — no reader changed behaviour:

- `sql/2026-09-08-video-obs-cache.sql`
- `sql/2026-09-08-channel-stats-precompute.sql`
- `sql/2026-09-08-video-text.sql` (table + mirror trigger)
- `sql/2026-09-08-track-drain-unscored-cursor.sql`
