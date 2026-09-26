# Disk growth: causes, fixes, and the guard that makes it visible — 2026-09-26

Supabase auto-expanded the Video Scripter disk 8 → 12 → 18 → 27 GB in about two months. The
database was 6.4 GB on 09-04, 10 GB on 09-14 and 15 GB this morning (~400 MB/day). This runbook
covers what caused it, what is fixed on branch `fix/disk-growth`, what was run, and what is
waiting for Brandon. All times ET.

Everything below was measured with catalog / `pg_stats` / `pgstattuple_approx` / aggregate queries;
no bulk rows were pulled to the client.

## Before and after (this session)

| | 07:30 ET | 08:17 ET |
|---|---:|---:|
| database (`pg_database_size`) | 15.1 GB | **13.9 GB** |
| `/data` volume used (metrics endpoint) | 60 % of 27,106 MiB | **56 %** |
| `video_score_history` | 1,392 MB (heap 1,280, **92.7 % free**) | **98 MB** (3.8 % free) |

The only production change was the online `pg_repack` of `video_score_history` (step B below).

## The causes, verified

### 1. The same ~2 GB of text stored twice, and the job that should clear it never ran

`video_text` (2,075 MB) holds a copy of `videos.description / metadata / llm_summary`. The 06:00
null-out required **zero** unmoved videos corpus-wide by a **05:48** deadline — while starting at
06:00, and while ingest added 3–30 K unmoved videos a day. It logged "standing down … Not a
failure" on 12 of 12 nights (`logs/null-video-text-launchd.log`). **A global "backlog == 0" gate
on a continuously-fed queue never opens.**

Three more defects on the same path:

- **The mover was timing out.** Its batch was `where id > $1 and not exists (…) order by id limit
  2000`. With only ~5 K of 1.17 M rows unmoved, one statement walked the whole primary key to find
  2,000 of them and hit the 120 s statement timeout (57014 in `logs/move-video-text-launchd.err.log`).
- **Ingest never wrote `video_text`.** Three copies of the same INSERT (nightly-ingest,
  drain-touch-queue, `lib/app/channels.ts`) wrote text into `videos` only, so every new video was
  born "unmoved".
- **The reader ratchet had two blind spots.** It never scanned `scripts/` (so `scripts/rss-poll.ts`,
  every 5 min, read `videos.description` unseen) and never looked at the database itself: 13
  functions / views / matviews read the moved columns, including `competitor_youtube_channels`,
  the live-ingest tracked-channel matview built entirely from `videos.metadata`.

### 2. `video_score_history`: a retention job that deletes but never returns disk

14-day retention, ~20 K rows/day (≈130 MB steady). Full rescoring bursts wrote 3.6 M rows; DELETE
leaves the file at its high-water mark: 1,280 MB heap, 94 MB live.

### 3. `rss_samples` / `view_samples`: a retention tier with no end

`rss_samples` 2,040 → 2,974 MB since 09-14, 97 % live. The thinning job is healthy; the policy is
the problem. The daily tier (> 14 days) keeps, per video per UTC day, the last reading **and** the
first reading, **for ever**. Measured on 2026-09-09 (a daily-tier day): 97,927 videos, 374,480
rows kept —

| rows kept per video-day | videos | rows | what they are |
|---|---:|---:|---|
| 1–2 | 75,863 | 121,786 | routine: last-of-day + first-of-day |
| ≥ 12 (avg 22) | 7,864 | 175,020 | launch windows: hourly first day, dense first 6 h |
| 3–11 | ~11,600 | ~77,700 | mixed |

At 262 B/row (heap + index) that is ~98 MB of rss per day of data **kept permanently**, plus
~13 MB/day of api readings (`view_samples`). It does not converge. See the proposal in §3 below.

### 4. Temp spills: historical, not current

`pg_stat_database.temp_bytes` = 10 TB lifetime, but `pg_stat_statements` since 2026-09-04 accounts
for 77.7 GB, dominated by two statements that have since been rewritten
(`observation.queue-claim` v1: 22 GB; the `rss_response_state` update: 19 GB, which has run 76
more times today with **zero** new spill). A 40-minute window this morning spilled 52 MB, all of it
this session's own measurements and the repack's index builds. Largest single statement ever:
542 MB. No query rewrite needed; the guard now tracks the daily spill rate, and
`temp_file_limit` (currently unlimited) is proposed below.

### 5. Other churny tables

| table | finding |
|---|---|
| `observation_change_log` | a queue (materializer deletes consumed rows); 2.8 M live, oldest 36 h — bounded |
| `view_samples` | same unbounded daily tier as rss, ~13 MB/day |
| `video_obs_cache` | 25 % free; one row per video — bounded |
| `thumbnail_versions` | 31 M updates on 212 K rows, 10 % free — fine |
| `videos` | 17 M updates, only **14 % HOT** (45 indexes, several on updated columns) |
| `view_snapshots` | ~33 K rows/day, **no retention**; CLAUDE.md promises a monthly >1-year cleanup that does not exist |
| `competitor_youtube_channels` | matview last refreshed ~2025-07-31 (818 rows) yet read by live ingest |

And one monitor was dead: `check-supabase-egress.py` threw on every run since 2026-09-10. Its PAT
now gets HTTP 403 from **every** project's api-keys endpoint. Fixed to log `NO DATA` (instead of
crashing, or worse, reporting 0 GB/day from zero projects); **the PAT needs renewing** (below).

## What changed (branch `fix/disk-growth`, not pushed)

### A. The null-out progresses every night (`b0a7937`)

- `lib/app/null-out-gate.ts` — `planNullOut` takes **no backlog**. The only refusals are per column
  (the reader ratchet) and the mirror trigger. `summarizeNullPass` reports progressed / idle / noop.
- `lib/app/video-text-move.ts` — `nullWindowSql` / `moveWindowSql` walk bounded windows of primary
  keys. The null-out proves equality in the UPDATE's own WHERE (`is not distinct from`), so a
  concurrently changed row is re-checked on its new version. The mover anti-joins on the window's
  keys before fetching any wide row: **2.6 s → 28 ms per 5,000-key window**; a full pass is 79 s.
- `scripts/null-video-text.ts` — resumable (cursor in `logs/state/`), time-budgeted, records an
  outcome, skips the walk for a week after a full pass found nothing (weekly re-verification).
- `scripts/null-video-text-tonight.ts` — no waiting, no deadline (old `--deadline` accepted and
  ignored), **no DDL** (the index drop is now a separate approved step, and it goes first).
- Ingest: one INSERT (`lib/app/video-text.ts videoInsertSql`) writes the `video_text` row in the
  same statement; the live-broadcast metadata write keeps both copies byte-equal.
- `CLEARED_COLUMNS` is the one list the null-out, the writers and the ratchet read.
- Tests: the gate replays the 12 real nights; `lib/app/video-text-null.integration.test.ts`
  (rolled back) runs exactly that state — an unmoved and a disagreeing row beside a clearable one —
  and proves the clearable one is cleared and the others are untouched and counted.

### B. `video_score_history` (`f22cd5a`)

- `scripts/reclaim-table.ts` + `lib/ops/reclaim.ts`: measure (pgstattuple_approx incl. TOAST),
  plan, refuse without 2× headroom, refuse > 500 MB live without `--approved`, rewrite, measure.
  **Ran it: `pg_repack` 1,392 MB → 98 MB in 19.4 s, online, 203,279 rows before and after.**
- Structural: `lib/readings/history-partitions.ts` — one partition per UTC day; `thin-readings`
  creates a week ahead and DROPs archived expired days (keeps DELETE until migrated). Migration
  `sql/2026-09-26-partition-video-score-history.sql` (+ rollback), rehearsed on a temp clone of the
  203 K live rows: **1.3 s**, every row in its day, id sequence and dependent view intact.

### C. The storage guard (`1402a85`, `1379bde`, `bdae558`, `3a2fc1f`)

- **Contract** — `lib/ops/storage-contract.ts`: every table over 10 MB declares a policy
  (`bounded-retention | queue | entity | derived-cache | append-forever | static`), a budget, a
  growth rate and what enforces it (or says "NOTHING"). Undeclared / over-budget / >50 % bloat
  fails. `lib/ops/storage-contract.db.test.ts` runs it live — it failed on exactly
  `video_score_history` this morning and passes after the reclaim. Partitions roll up to their parent.
- **Daily snapshot + projection** — `scripts/storage-guard.ts` (plist
  `scripts/launchd/com.mfm.video-scripter-storage-guard.plist`, 07:15): catalog-only sizes to
  `logs/storage-snapshots.jsonl`, 7-day growth vs declared rates, days until the `/data` volume
  hits the 90 % autoscale trigger (Prometheus metrics), temp-spill rate. Alerts: macOS
  notification + Pulse operations receipt; exit 2.
- **Silent-job detection** — `lib/ops/job-outcomes.ts` + `lib/ops/scheduled-jobs.ts`: the move,
  null-out and thin jobs write outcomes (progressed / idle / noop / stood_down / failed, with
  backlog); the guard alerts on 3 consecutive "had work, did none" runs, repeated failures, or a
  job whose stdout log went quiet. A test fails if a LaunchAgent is installed that the registry
  does not declare. First run found the egress alarm's log silent for 407 h.
- **DB half of the ratchet** — `lib/app/video-text-db-objects.db.test.ts`.

## Independent review

A separate review pass over the branch found one data-loss path — `VIDEO_TEXT_UPSERT_SQL` set
`llm_summary = excluded.llm_summary`, and the unified import never carries a summary, so a re-import
after the null-out would have destroyed the only copy — plus: the null-out trusted an unlocked
`video_text` row (now `FOR SHARE`), a cleared-metadata broadcast write left a permanently
disagreeing original, VACUUM FULL could never run (multi-statement `-c`), and the partition
straggler copy used `id > max(id)` on a shared sequence. All fixed test-first in `f94cf84`, with six
robustness fixes. Accepted as-is: `move-video-text` has no persisted cursor (a full pass is 79 s
against a 1,200 s budget); the ledger trim can race a concurrent append (one lost line at worst);
`pg_repack` receives the session URL as a docker argument (visible in local `ps`).

## Awaiting Brandon (in this order)

| # | what | command | lock / impact | returns |
|---|---|---|---|---|
| 1 | merge + deploy the branch; install the guard | `cp scripts/launchd/com.mfm.video-scripter-{storage-guard,null-video-text,move-video-text}.plist ~/Library/LaunchAgents/` then `launchctl bootout` / `bootstrap` each | none | — |
| 2 | drop the three llm_summary indexes (**before** the null-out, so its updates can be HOT) | `psql "$DATABASE_SESSION_URL" -v ON_ERROR_STOP=1 -f sql/2026-09-26-drop-llm-summary-indexes.sql` | `DROP INDEX CONCURRENTLY`: no blocking lock | **242 MB** now |
| 3 | the llm_summary null-out then runs nightly by itself (or now) | `npx tsx scripts/null-video-text.ts --dry-run` then without `--dry-run` | row locks per 5,000-key window | frees ~90 MB inside the heap |
| 4 | partition `video_score_history` | `psql "$DATABASE_SESSION_URL" -v ON_ERROR_STOP=1 -f sql/2026-09-26-partition-video-score-history.sql`, then the straggler copy + `drop table video_score_history_unpartitioned` in its header | writers blocked ~2–5 s (1.3 s on the clone, without WAL); readers not | future bursts leave by themselves |
| 5 | clear `description` / `metadata` (see §1c: readers already repointed; audit 12 `select('*')` routes + unified-import first) | add to `CLEARED_COLUMNS`; for metadata apply `sql/2026-09-26-metadata-db-readers.sql` first | recreated dashboard matviews: readers of each wait 1–3 min; nothing else | ~1.06 GB of live text leaves `videos` |
| 6 | `pg_repack videos` after 5 has completed a full pass | `npx tsx scripts/reclaim-table.ts --table videos --dry-run`, then `--approved` | **online**: ACCESS EXCLUSIVE only at start and swap (seconds, `--wait-timeout 60`); total run est. 2–10 min (score-history ran at 76 MB/s; `videos` rebuilds 45 indexes, so expect the slow end); needs ~3 GB free (10.7 GB free today) | `videos` 4,152 → **~2.5 GB** |
| 7 | readings terminal tier (§3) | decision | deletes archived readings | ~50–100 MB/day of growth stops |
| 8 | `temp_file_limit` | `alter role postgres set temp_file_limit = '2GB';` (and the app role) | config | no single query can spill toward the 90 % trigger (max ever: 542 MB) |
| 9 | renew the Supabase PAT for the egress alarm | save a new token to `~/.config/supabase/access-token` | — | egress alarm back |

**Do not VACUUM FULL `videos`.** It would hold ACCESS EXCLUSIVE for the whole rewrite: reading
1,782 MB heap + 920 MB toast and rebuilding 45 indexes — roughly 2–7 minutes at best and tens of
minutes on this instance's baseline IO, with the app, RSS poller, scorer and workers all blocked.
A repack **today** would reclaim only ~330 MB (8 %) — `reclaim-table.ts` refuses it as not worth
it; the text columns must be cleared first.

### §1c — clearing description and metadata

**Done on this branch (merge `a516999`):** all 27 ratchet entries (10 `description`, 17 `metadata`)
plus `discover-new-videos` now read and write through `lib/app/video-text.ts`
(`videosTextPayload` + `writeVideoTextFields` for writers, `VIDEO_TEXT_JOIN` + coalesce or
`videoTextFor`/`hydrateVideoTextFields` for readers). Both `BLOCKED` lists are empty. The three
`description ilike '%#shorts%'` filters now use the verified `is_short` (deliberate). Evidence for
the `metadata->>'youtube_channel_id'` rewrites (TABLESAMPLE 1 %, one-row aggregates): wherever the
key exists it equals `channel_id` (7,475/7,475), but ~35 % of competitor rows lack it, so presence
checks still go through the side table.

**`CLEARED_COLUMNS` is deliberately still `['llm_summary']`.** Before adding `description` or
`metadata`:

1. Audit the `select('*')` readers the scanner cannot see (payload/row variables): `vector/videos`,
   `vector/process-video`, `lib/pinecone-summary-service.ts`, `tools/find-content-gaps`,
   `search/unified`, `tools/detect-novelty-factors`, `tools/suggest-pattern-hypotheses`,
   `app/actions/skyscraper-analysis.ts`, `skyscraper/analyze-stream`,
   `tools/find-competitive-successes`, `classification/auto-run`,
   `tools/get-comprehensive-video-analysis`.
2. Fix `lib/unified-video-import.ts`'s small-batch `.upsert(videos)`: it writes all three text
   columns (including the already-cleared `llm_summary`) into `videos` and no `video_text`. Safe for
   the null-out (a disagreeing row is never cleared, a missing side row is moved first) but it
   re-duplicates text. (Its other path, `writeVideoText`, used to NULL `video_text.llm_summary` on
   every re-import — fixed in `f94cf84`; see Review.)
3. For `metadata` only: apply `sql/2026-09-26-metadata-db-readers.sql` (awaiting approval) so no
   live database object reads it (`lib/app/video-text-db-objects.db.test.ts`). It freezes
   `competitor_youtube_channels` rather than recomputing it.
4. Deploy the app before the next 06:00 null-out after the flip.

After the flip the nightly null-out clears the column by itself (description/metadata are not
indexed except `idx_videos_competitor_metadata`, which then becomes dead weight: 28 MB).

Cheaper alternative, for the record: null the **side** copies of description/metadata in
`video_text` instead (the accessor already falls back to `videos`), then repack `video_text`.
Returns ~1.3 GB with no reader work — and abandons the reason for the move (a `videos` heap that
fits the 512 MB buffer pool). Not recommended.

### §3 — readings terminal tier (proposal)

Two independent changes, both deleting only R2-verified days, both with thinning's delta
suppression:

1. **First-of-video instead of first-of-day.** The first-of-day rule exists for
   `growthExponent()`, which reads a video's earliest and latest readings only. Keeping the first
   reading of the video's first day (plus the existing last-of-day) preserves both; it halves the
   routine band. Verify with `npm run verify:archive` (checks c and d) before enabling.
2. **Weekly after 60 days.** Past two months, keep the last reading of each (video, ISO week).

Together: the permanent rss+api band drops from ~46 MB/day (routine) to ~5 MB/day; launch
windows (~46 MB/day, proportional to new uploads) are unchanged by design.

## Projection

- After items 2–6: database ≈ **12.2 GB** (−0.24 indexes, −1.4 `videos`).
- Growth after that, measured components: corpus entity growth ~5.3 K new videos/day × ~12 KB
  (row, text, launch readings, caches) ≈ 65 MB/day; routine readings band 46 MB/day (≈ 5 with §3);
  `view_snapshots` 10 MB/day (no retention). **≈ 120 MB/day today, ≈ 80 MB/day with §3.**
- There is no absolute steady state while the corpus grows; with §3 every remaining term is
  proportional to corpus growth. At 80 MB/day the 27 GB volume reaches 90 % in ~4 months
  (the guard recomputes this daily and warns at 30 days).

## Lessons (encoded)

1. A global "backlog == 0" gate on a continuously-fed queue never opens. Gate per item.
2. A job that exits 0 while doing nothing is invisible to every exit-code monitor. Record outcomes
   and alert on consecutive no-ops with backlog.
3. DELETE-based retention does not return disk. Partition time-series tables by the retention unit.
4. "Nothing reads this column" must include scheduled scripts and the database's own functions,
   views and matviews.
5. A monitor that reports "0" from zero inputs is worse than one that crashes.

## Executed 2026-09-26 (Brandon: "Do it all") — 10:53–14:45 ET

| # | item | result |
|---|---|---|
| 1 | merge + deploy + LaunchAgents | main fast-forwarded (the checkout's uncommitted 09-22 work preserved on top; backup patch kept), pushed. First Vercel build **failed**: the Edge route `app/api/ai/chat` now reached `pg` through vector-db-service → accessor. Fixed test-first (`lib/vector-search.ts` split + `lib/ops/edge-runtime-imports.test.ts`), local `npm run build` green, redeployed Ready. Every import after the 10:53 merge has its `video_text` row (0 of 196 before, 140 of 140 after within the hour). storage-guard / null-video-text / move-video-text agents installed. |
| 2 | drop 3 llm_summary indexes | done, CONCURRENTLY; 5 s lock_timeout was too short for the wait on old transactions (left one index invalid, dropped on retry with 5 min). −243 MB. |
| 3 | partition video_score_history | done, 5.3 s; 203,279 rows, 22 daily partitions, 0 stragglers, old table dropped. |
| 4 | audit + clear description/metadata | 39 `select('*')` files audited (2 hydrate now; guard test); unified-import small batch fixed; `sql/2026-09-26-metadata-db-readers.sql` applied (dashboard matview block needed a 20 min timeout); `idx_videos_competitor_metadata` dropped first so the updates could be HOT (15 → 3 ms/row). Equality verified on a 50 K head sample and a random 2 % (23,989 rows): 0 disagreements. Clear-out pass: **1,186,660 rows** in bounded windows, 0 disagree; a 1 % sample afterwards holds no text. The back-off probe was standing down on autovacuum — fixed (client backends only). |
| 5 | pg_repack videos | 2,980 → **1,156 MB** in 533 s, online (autovacuum had already truncated the toast 920 → 16 MB). At the swap pg_repack cancelled two conflicting backends (launch-track, materializer), both ran clean on their next tick. 1,187,082 rows in videos and video_text. |
| 6 | readings terminal tier | first-of-video past 14 d, weekly past 60 d; SQL mirrors the pure policy; harness at +70 d: chart lines 0.80 % / 0.74 %, 0 of 191 growth exponents changed. Ledger labels `day-v2` / `week-v2` (constraint applied). Only R2-verified days are thinned; tonight re-thins the 20 daily-tier days (all verified). |
| 7 | temp_file_limit | **blocked**: `permission denied to set parameter "temp_file_limit"` — Supabase's `postgres` role cannot set it. Needs the Management API (PAT) or dashboard. |
| + | video_score_history access | RLS on, anon/authenticated revoked on parent, partitions, default and the view; new partitions close themselves. All callers are direct Postgres as BYPASSRLS roles. `history-access.db.test.ts`. |
| + | view_snapshots | proposal only (`lib/readings/snapshot-retention.ts`), nothing deleted. Estimate: 3,396,729 rows → keep 3,024,541, removable 372,188 (~111 MB, all > 1 year). The tracking cadence already thins by age, so the policy saves little; the bigger lever is its indexes (701 MB on a 307 MB heap: uuid pkey, a unique (video_id, date) and an INCLUDE copy of it). |

**After:** database 15.1 → **11.0 GB**; `/data` 60 % → **46 %** of 27,106 MiB. Guard (run via the
LaunchAgent at 14:12): exit 2 with two expected alerts (thin-readings has not recorded yet; egress
alarm NO DATA — PAT). macOS notification path ran; the Pulse receipt got HTTP 404 and is queued in
the outbox (Pulse's receipt endpoint, same as other jobs today).

**Projection:** ~12 GB of headroom to the 90 % trigger. Growth ≈ 80–120 MB/day (corpus-driven)
→ roughly 100–150 days; the guard recomputes daily and warns at 30.
