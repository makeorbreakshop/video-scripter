# Reclaiming `videos` — move, null, repack — 2026-09-14

`videos` is **3,984 MB** (heap 1,734 / indexes 1,352 / toast ~890) with 1,107,961 rows, against a
512 MB `shared_buffers`. `description`, `metadata` and `llm_summary` are **86 %** of the tuple
width (measured 2026-09-08: 1,038 + 742 + 210 bytes of a 2,065-byte row). Every page that joins
the table pays for bytes it never renders.

There are three steps and they are often confused. **Only the third returns space to the disk.**

| step | script | reversible? | what it changes |
|---|---|---|---|
| 1. move | `scripts/move-video-text.ts` | yes | copies the text into `video_text`. `videos` does not shrink by one byte. |
| 2. null | `scripts/null-video-text.ts` | **no** | sets the three columns to NULL. Frees space *inside* the heap; the file stays the same size. |
| 3. repack | `pg_repack` | yes | rewrites the heap without the dead space. **This is the step that shrinks the file.** |

## Step 1 — the move

Fixed 2026-09-14. It had resumed from `select max(video_id) from video_text`; the mirror trigger
inserts every newly ingested video there as it arrives, so that max was a fresh id near the top
of the key space and the walk declared itself finished after **19,659 of 1,107,961 rows**, six
nights running. It now walks `videos` in primary-key order and anti-joins what `video_text`
already holds, so it is resumable from anywhere including `''`. Pinned by
`lib/app/video-text-move.test.ts`.

Runs nightly at 05:30 (`com.mfm.video-scripter-move-video-text`).

## Step 2 — the null-out. NOT SCHEDULED, AND HERE IS WHY

`scripts/null-video-text.ts` is written, tested and gated. It is **not** in launchd and must not
be until the precondition below is met.

**Thirty live call sites still read `videos.description` / `metadata` / `llm_summary` directly**
rather than through `lib/app/video-text.ts`. The moment the columns are NULL, every one of them
silently serves empty text — no error, no failure, just missing descriptions in the app, the
classification workers and the semantic layer:

```
app/api/adapt-idea, analyze-channel-style, analyze-pattern{,-enhanced},
classification/{auto-run,llm-batch}, extract-frames, idea-radar,
vector/search/description, workers/llm-summary/{control,progress,run},
workers/vectorization/{control,progress}
app/dashboard/{age-adjusted-debug,youtube/worker}, app/videos/[id]
components/video-detail-modal
lib/{llm-format-classification-service,llm-summary-batch-processor,
     pinecone-summary-service,unified-import-summary-integration,unified-video-import}
workers/llm-summary-worker{,-450,-fast,-optimized,-optimized-io,-speed-optimized},
workers/llm-summary-vectorization-worker
```

`lib/app/video-text-access.test.ts` is the ratchet: it fails if a **new** direct reader appears,
fails if a listed one is repointed but not removed from the list, and states the remaining count.
When that list is empty the null-out is safe to schedule, **and not one night before.**

The script defends itself too. It refuses to run if any row disagrees between the two copies, and
refuses if any video is not yet in `video_text` (`--force` overrides). It clears only rows whose
three columns are `is not distinct from` their side copy — exact on NULLs in both directions,
which `=` is not.

### Why it is not scheduled for tonight 06:00 either

Even ignoring the readers: the mover has ~1,097,222 rows left. At the ~1,000 rows/s the dry run
suggests that is ~18 minutes from its 05:30 start, so the arithmetic alone would fit before
06:00. It does not matter — the thirty readers are the blocker, not the clock. Scheduling a
destructive, irreversible pass behind a 12-minute margin *and* an unmet correctness precondition
would be two unforced risks for no gain.

## Step 3 — the repack

**`pg_repack` 1.5.2 is available on this instance** (`pg_available_extensions`), not yet
installed:

```
 name       | default_version | installed_version
 pg_repack  | 1.5.2           | (null)
```

That is the good outcome: `pg_repack` rewrites the heap **online**, taking a brief ACCESS
EXCLUSIVE lock only at the start and at the swap, rather than holding one for the whole rewrite.

`VACUUM FULL` is the alternative and is **not** an option here: it takes ACCESS EXCLUSIVE on
`videos` for the entire rewrite. On a 1,734 MB heap on disk doing 5–23 ms/block that is tens of
minutes during which **every read and write of the table blocks** — the app, the RSS poller, the
scorer and the classification workers all stop. It also needs as much free disk as the table it
is rewriting, and the instance has 18 GB provisioned against 11 GB used. Do not schedule it.

### Preconditions, none of which are met today

1. Step 2 has run (nothing to reclaim before the columns are NULL).
2. The **client binary** is installed and its version matches the server extension. It is not:
   `which pg_repack` → not found. `brew install pg_repack`, then check `pg_repack --version`
   reports 1.5.2.
3. The extension is created: `create extension pg_repack;` (superuser; on Supabase this is done
   from the dashboard SQL editor).
4. Free disk for the duration: `pg_repack` needs room for a second copy of the table and its
   indexes while it works. After step 2 the `videos` copy should be ~1.4 GB rather than 4 GB, and
   18 GB provisioned against a then-smaller database has room — **verify before running.**

### The job, when the preconditions are met

`scripts/launchd/com.mfm.video-scripter-repack-videos.plist` — a **one-shot**, disabled by
default, 06:30 ET. Install and run it deliberately, once, then remove it:

```bash
cp scripts/launchd/com.mfm.video-scripter-repack-videos.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.mfm.video-scripter-repack-videos.plist
launchctl kickstart -p gui/$UID/com.mfm.video-scripter-repack-videos   # run it now, watch it
# when it has finished and the size is confirmed:
launchctl bootout gui/$UID/com.mfm.video-scripter-repack-videos
rm ~/Library/LaunchAgents/com.mfm.video-scripter-repack-videos.plist
```

Rollback: `pg_repack` is interruptible. Killing it leaves the original table untouched (it builds
a copy and swaps at the end) and leaves behind a `repack.*` schema to drop:
`drop schema repack cascade;`.

## Expected sizes

| | now | after null-out | after repack |
|---|---:|---:|---:|
| `videos` heap | 1,734 MB | 1,734 MB (dead space inside) | ~400–500 MB |
| `videos` toast | ~890 MB | ~890 MB (dead) | ~0 |
| `videos` total | 3,984 MB | 3,984 MB | **~1.8 GB** |

`video_text` gains roughly the 2 GB the originals occupied, so the **net** win is the toast and
heap bloat plus a `videos` heap small enough that the sequential scans the nightly export and the
classification workers do stop being the dominant I/O on the instance. That second effect is the
one that matters: it is why the move is worth doing even though the bytes mostly move rather than
disappear.
