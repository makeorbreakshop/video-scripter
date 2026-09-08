# Columnar readings — the serving/analytics split

*2026-09-08, branch `feat/columnar-readings`. Follows `~/shared-memory/knowledge/projects/
video-scripter/2026-09-08-r2-readings-archive.md` and `2026-09-08-database-performance-
investigation.md`, which are still the source for the numbers this builds on.*

The rule this implements:

> Postgres holds what the product **reads**. Raw readings are columnar on R2. Pages never read
> raw readings. Analytics and benchmarks run on parquet, never on production Postgres.

---

## 1. The per-video series file

`series/<video_id>.json.gz` on the private `channelsmith-readings` bucket: one video's whole
reading history (`view_snapshots` + `view_samples` + `rss_samples`, raw rows and flags) plus the
packaging version markers the chart draws (`thumbnail_versions`, `title_versions`).

**Why gzipped JSON, not parquet.** It is one video's few thousand points, read whole, in a request
path. Column pruning buys nothing when every column is wanted, and zlib + `JSON.parse` beats a
parquet decoder. Measured on 226 real videos: **370 bytes mean** (these are lightly tracked); a
2,000-point video is ~6 KB gzipped.

**Why the raw rss rows and not the drawn line.** The page filters rss on `views is not null and
not conflicted`; the scorer filters on `model_eligible and not conflicted`
(`lib/scoring/observations.ts`). The file keeps the flags and `seriesRss(file, 'page' | 'model')`
applies the predicate. Bake one in and the file can only ever serve one consumer.

### Write-through is a queue, not a PUT

Five paths ingest readings, and one RSS tick can move 5,000 videos:

| writer | file | shape |
|---|---|---|
| `saveRssObservations` | `lib/rss/response-store.ts` | batch, in a transaction |
| `writeSampleBatch` | `lib/nightly/sample-batch.ts` | batch, in the caller's transaction |
| `ingestWrites` / `firstSampleWrite` | `lib/ingest/first-sample.ts` | one row per video, four call sites |
| title versions | `scripts/rss-poll.ts` | batch |
| thumbnail versions | `scripts/thumbnail-watch.ts` | one per change |

Rebuilding inline would be 5,000 GETs and 5,000 PUTs on the poller's critical path. Instead each
writer marks the videos dirty — **one statement over an `unnest()`**, into `series_dirty
(video_id primary key, marked_at, attempts)` — and `scripts/rebuild-series.ts` drains the queue.
Cost is one PUT per video that moved, however many readings landed on it.

**The savepoint matters.** In Postgres any failed statement aborts the transaction. Two of the
writers mark inside a transaction that is about to commit real readings, so an unprotected mark
that hit (say) a missing table would turn the caller's `commit` into a `rollback` and lose the
readings. `markSeriesDirty(db, ids, { transactional: true })` wraps the mark in a `SAVEPOINT`:
the mark can be lost, the readings cannot.

### The read path

`lib/admin/queries.ts videoPage()` tries the series file first and falls back to the same five
Postgres queries on a miss, counting both (`[series] fallback to postgres video=… rate=…%`).
`SERIES_DISABLE=1` forces every read back to Postgres — the kill switch, and the control arm of
the equality test. `?raw=1` is untouched: it still reads the day-partitioned parquet archive
through `lib/app/raw-readings.ts`.

### Proof

`lib/readings/series-equality.integration.test.ts` renders the real video page twice per video —
once with `SERIES_DISABLE=1`, once off the file — and compares the drawn line, the measured
points, the packaging marks and events, the horizon and the counts.

```
series equality: 26 videos compared, 0 differing, max deviation 0.0000%
```

### Commands

```bash
npm run series:drain                       # rebuild the queued videos
npm run series:backfill                    # every video, incl. archived readings
npx tsx scripts/rebuild-series.ts --videos abc,def --with-archive
npx tsx scripts/rebuild-series.ts --drain --dry-run
```

---

## 2. The harness on parquet

`--source parquet` on `benchmark-scores.ts`, `backtest-baseline-trend.ts`,
`check-band-calibration.ts`; `weekly-refit.ts --source parquet` passes it to all three through
`HARNESS_SOURCE`. `score_params` stays on Postgres — one small indexed row, and the thing a refit
is judging.

`lib/readings/parquet-source.ts` is **DuckDB** (`@duckdb/node-api`) over the archive, cached under
`$TMPDIR/video-scripter-parquet` (override with `PARQUET_CACHE_DIR`).

**Why DuckDB over parquetjs-lite** (which is already in the tree): parquetjs-lite decodes row by
row into JS objects, and a benchmark touches millions of rows. More importantly DuckDB is SQL, so
the harness queries move across **as text** instead of being rewritten as array code — and a
rewrite is exactly where "identical results" quietly stops being true.

**The memory ceiling is not optional.** Every connection is opened with `memory_limit=2GB`,
`threads=4`, and a `temp_directory` capped at 8 GB so a big aggregate **spills** instead of taking
the machine.

Five dialect differences are handled, two of which were real correctness bugs:

| | |
|---|---|
| `= any($1)` | → `in (select unnest(…))` |
| `collate "C"` | dropped; DuckDB is byte-wise already |
| `longformSql()` | → the `is_longform` column the export precomputes **with `longformSql()` itself** |
| **`TimeZone`** | forced to UTC. `snapshot_date::timestamptz` is midnight in the *session* zone; on a laptop in New York every snapshot landed four hours from where Postgres put it. **131 of 131 rows** of the backtest's query differed on nothing else. |
| **`at`** | reserved in DuckDB (`AT TIME ZONE`), so a bare `at` in a select list will not parse — and that is the shape of `OBSERVATION_RECORDS_SQL`. Qualified and quoted forms are left alone; string literals are stepped over. |

`lib/scoring/harness-sql.ts` holds the three harnesses' readings queries verbatim, so the diff
below runs the same text they do. **They deliberately disagree** about what a reading is
(benchmark merges all three sources with a 12-hour paid-precedence rule; the backtest reads only
`view_snapshots`; calibration reads snapshots + samples and no rss at all). Unifying them is a
scoring change with its own benchmark, not a refactor.

### The nightly table export

`scripts/export-tables.ts` writes `export/day=YYYY-MM-DD/{videos,video_scores,view_snapshots}.parquet`.
`videos` is **slim on purpose** — see §3: `description` and `metadata` are 86 % of the row and no
harness reads either. A scoped or sampled export gets a suffixed day key so it can never be
mistaken for the corpus.

### Proof

`scripts/verify-parquet-harness.ts` runs the harnesses' own query texts through both engines over
one channel's corpus and diffs row for row (values canonicalised, order ignored — every consumer
regroups by `video_id`):

```
MATCH   observation_records   pg 1630 rows  444 ms | parquet 1630 rows   54 ms
MATCH   benchmark.records     pg 1060 rows  597 ms | parquet 1060 rows   77 ms
MATCH   benchmark.day30       pg    0 rows  119 ms | parquet    0 rows    2 ms
MATCH   backtest.snapsFor     pg   79 rows  119 ms | parquet   79 rows    4 ms
MATCH   calibration.day30     pg    0 rows  123 ms | parquet    0 rows    2 ms
MATCH   calibration.meta      pg  150 rows  124 ms | parquet  150 rows    7 ms
DIFFER  benchmark.population   — needs a FULL export; this run used a single-channel one
DIFFER  calibration.records    — reads view_samples, which the archive has held for four days
```

Six of eight identical, 5–25× faster. The two that differ are **coverage, not correctness**, and
both close once the nightly export and a few more nights of archive have run.

### Commands

```bash
npm run export:tables                                   # nightly corpus export
npx tsx scripts/export-tables.ts --channel UC...        # a scoped corpus, own key
npm run verify:parquet -- --channel UC... --export-day 2026-09-08-channel-UC... \
  --window 2026-09-04..2026-09-04
npx tsx scripts/benchmark-scores.ts --source parquet
npx tsx scripts/weekly-refit.ts --source parquet
```

### What is still on Postgres, and why

| | why |
|---|---|
| `score_params` | one indexed row; a candidate written 30 s ago must not come from last night's export |
| `score-videos.ts --fit`, `fit-forecast-bands.ts` | they **write** `score_params` and score the live corpus |
| `model_evals`, `pg_stat_activity` | the refit's own bookkeeping and its back-off preflight |
| everything the app serves | scores, params, bands, channel rows — small, indexed, and changing hourly |

---

## 3. Why `videos` is 4 GB

Catalog measurements, 2026-09-08. Nothing here required a scan of the table.

```
videos   3,962 MB total  =  1,734 MB heap  +  1,339 MB indexes  +  889 MB toast
                            1,164,888 rows
```

Column widths, block sample of 2,270 rows (`tablesample system (0.2)`), confirmed against a
1,000-row ordered sample:

| column | avg bytes | share of row |
|---|---:|---:|
| `description` | 1,038 | 50.3 % |
| `metadata` (jsonb) | 742 | 35.9 % |
| `llm_summary` | 210 | 10.2 % |
| `title` | 59 | 2.9 % |
| **whole row** | **2,065** | |

**`description` + `metadata` are 86 % of the tuple width.** 6.7 % of rows have no description,
26 % have no metadata. They account for essentially all 889 MB of toast and most of the heap.

Indexes: **42 of them, 1,339 MB.** Nineteen have fewer than 1,000 lifetime scans and total
**400 MB**:

```
  101 MB  scans=   32  idx_videos_channel_views
   28 MB  scans=   68  idx_videos_classified_at
   27 MB  scans=   44  idx_videos_competitor_metadata
   24 MB  scans=  596  idx_videos_competitor_channel
   21 MB  scans=  135  idx_videos_topic_niche
   21 MB  scans=   37  idx_videos_topic_domain
   19 MB  scans=  110  idx_videos_format_primary
   18 MB  scans=  240  idx_videos_thumbnail_version
   17 MB  scans=  101  idx_videos_idea_radar_complete
   17 MB  scans=  414  idx_videos_title_observed
   16 MB  scans=  556  idx_videos_is_short
   16 MB  scans=    6  idx_videos_topic_level_2
   15 MB  scans=  302  idx_videos_topic_level_3
   15 MB  scans=   32  idx_videos_user_id
   13 MB  scans=   30  idx_videos_channel_name_lower_pattern
 8640 kB  scans=  311  idx_videos_bertopic_version
 4032 kB  scans=  426  videos_shorts_backfill_idx
 2952 kB  scans=    7  videos_shorts_flagged_unchecked_idx
   40 kB  scans=  900  idx_videos_channel_published_views
```

### What was executed

**Nothing.** No column was moved, no index was dropped.

`pg_stat_database.stats_reset` is **null**, so those scan counts are since the last server
restart and cannot be dated. An index with 32 scans might be the one thing standing between a
monthly job and a sequential scan of a 1.7 GB table, and undoing a drop means `CREATE INDEX
CONCURRENTLY` on that table — expensive, and not something to discover you need at 3 a.m. Neither
half of "trivially safe and reversible" holds, so this stays a plan.

### The plan, in order of return per unit of risk

1. **Move `description` to a side table.** ~1.2 GB of heap + toast. It is written by the ingest
   paths and by `description_versions` (which already keeps its own history, 112 MB), and read by
   the LLM summary worker and the semantic layer — a small, enumerable set of call sites.
   `create table video_descriptions (video_id text primary key references videos(id), description
   text)`, backfill in keyset batches, repoint the readers, then drop the column. Reversible at
   every step until the drop; the drop itself is instant and the data still exists in the side
   table.
2. **Move `metadata` to the side table too, or to R2.** ~860 MB. Audit first: `metadata` is read
   by `videoPage()` and `loadVideoHead()`, so it is on the request path and cannot simply leave
   for an object store without a cached read model. The cheaper first move is to keep it in
   Postgres, next to the description.
3. **Retire the cold indexes,** 400 MB, but only after `pg_stat_reset()` and a full week (and a
   full monthly cycle) of fresh counts. Do the 101 MB `idx_videos_channel_views` first and alone:
   it has 32 scans and is a quarter of the whole prize.
4. **`llm_summary`** (~240 MB) belongs with the description in the side table; it is already
   nullable and already has its own status columns.

Ceiling if all four land: roughly **2.5 GB off a 3.96 GB table**, and — the part that actually
matters for the disk-pressure deadline — a `videos` heap small enough that the sequential scans
the nightly export and the classification workers do stop being the dominant I/O on the instance.

---

## Jobs to install

```bash
cp scripts/launchd/com.mfm.video-scripter-series-drain.plist    ~/Library/LaunchAgents/
cp scripts/launchd/com.mfm.video-scripter-export-tables.plist   ~/Library/LaunchAgents/
cp scripts/launchd/com.mfm.video-scripter-series-backfill.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.mfm.video-scripter-series-drain.plist
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.mfm.video-scripter-export-tables.plist
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.mfm.video-scripter-series-backfill.plist
```

| job | when | what |
|---|---|---|
| `…-series-drain` | every 10 min | rebuild the series files for videos whose readings moved |
| `…-archive-readings` | 02:30 (already installed) | raw readings → parquet, then thin |
| `…-export-tables` | 03:15 | videos / video_scores / view_snapshots → parquet |
| `…-series-backfill` | 04:00 | every series file, folding in the newly archived days |

Order matters: the backfill runs after the archive so a video thinned at 02:30 has its full
history back in its series file by 04:00.

All three refuse to start while anything has been running in Postgres for over two minutes.

---

## One thing that went wrong, and the guard for it

Re-archiving `rss 2026-09-03` today to pick up the new flag columns **overwrote a complete archive
with the thinned survivors**: the day's parquet went 34.9 MB → 17.2 MB (286,346 rows). The day had
already been thinned in Postgres at 02:30, so re-reading it read the hourly survivors, and the
rows deleted from Postgres are now gone from R2 as well. Roughly half that day's rss readings.

`scripts/archive-readings.ts` now **refuses** to write a day whose ledger row says the archive
holds more rows than Postgres currently does, naming the number it would delete. `--allow-shrink`
overrides it. Re-running a day is idempotent only **before** it has been thinned.
