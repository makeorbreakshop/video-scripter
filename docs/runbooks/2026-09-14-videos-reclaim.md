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

> **Updated 2026-09-14, after the reader sweep was rebuilt.** Step 2 no longer clears all three
> columns at once. `llm_summary` has no direct readers left and is scheduled for tonight;
> `description` and `metadata` have 10 and 18, and are not. Step 3 is not worth a night until
> `description` is cleared, because that column is where the bytes are. See "What actually runs
> tonight" below.

## Step 1 — the move

Fixed 2026-09-14. It had resumed from `select max(video_id) from video_text`; the mirror trigger
inserts every newly ingested video there as it arrives, so that max was a fresh id near the top
of the key space and the walk declared itself finished after **19,659 of 1,107,961 rows**, six
nights running. It now walks `videos` in primary-key order and anti-joins what `video_text`
already holds, so it is resumable from anywhere including `''`. Pinned by
`lib/app/video-text-move.test.ts`.

Runs nightly at 05:30 (`com.mfm.video-scripter-move-video-text`).

## Step 0 — THE TRIGGER. Read this before anything else.

`sql/2026-09-08-video-text.sql` installed `video_text_mirror_upd`:

```sql
create trigger video_text_mirror_upd after update on videos
  for each row
  when (old.description is distinct from new.description
     or old.metadata is distinct from new.metadata
     or old.llm_summary is distinct from new.llm_summary)
  execute function video_text_mirror();
```

`scripts/null-video-text.ts` issues `update videos set llm_summary = null`. **That is exactly
the trigger's WHEN condition.** The trigger fires and upserts NULL into `video_text`.

So the null-out, as written and gated and tested on 2026-09-13, would not have freed 2 GB of
text. It would have **deleted the only remaining copy of it**, one batch at a time — and every
safety check in the script would have kept passing at every step, because after the trigger has
run the two copies genuinely do agree. They agree on nothing.

Both triggers were confirmed installed on the live instance on 2026-09-14.

Fix: `sql/2026-09-14-retire-video-text-mirror.sql`, applied **before** the null-out. Rollback in
`sql/rollback/`. `scripts/null-video-text.ts` now refuses to start while either trigger exists,
and `--force` does not override that particular refusal — there is no scenario in which running
underneath it is the intended outcome.

**Why dropping it is safe.** The trigger's job was to catch writers that did not go through the
accessor. After the 2026-09-14 refactor the five services and both workers write through
`lib/app/video-text.ts`. The two live scheduled ingest paths that still name `description` in an
INSERT — `scripts/nightly-ingest.ts` and `scripts/drain-touch-queue.ts` — write it only on
INSERT of a brand-new video (their `on conflict` clauses touch `is_short` and
`shorts_checked_at` and nothing else), and a brand-new video has no `video_text` row, so the
mover picks it up by anti-join on its next pass. Coverage is preserved.

## Step 2 — the null-out, one column at a time

### The reader sweep was wrong, in both directions

The old gate was three `rg` patterns and a list of thirty files.

It **over-matched**: six of the thirty were never readers — `worker_type: 'llm_summary'` string
literals, and the sibling columns `llm_summary_generated_at` / `_model` / `_embedding_synced`,
which are flags that stay on `videos`. Those six could never be repointed, so the list could
never reach zero, so the gate could never open.

It **under-matched**, which is worse: it never grepped for `metadata` at all — one of the three
columns it exists to protect. The real count:

| column | direct readers | status |
|---|---:|---|
| `llm_summary` | **0** | cleared — scheduled tonight |
| `description` | **10** | blocked. Five of them WRITE it back on import. |
| `metadata` | **18** | blocked. None were ever on the old list. |

`lib/app/video-text-sweep.ts` is the scanner that replaced the greps, and
`lib/app/video-text-access.test.ts` is the per-column gate over it. The scanner understands the
two shapes this codebase uses to reach the column and the three idioms that are legitimate
(`coalesce(vt.x, v.x)`, reading `video_text`, the sibling columns), and it only looks for SQL
inside strings that contain a SQL verb — because `description: v.description ?? undefined` on a
row already hydrated by `videoTextFor` is correct code that a bare grep calls a violation.

The `description` blockers matter for a second reason: `app/api/concept-search`,
`concept-search-multi` and `lib/pinecone-service.ts` filter with
`.not('description','ilike','%#shorts%')`. Once the column is NULL that predicate matches **no
rows**, so those searches return empty and nothing reports an error.

### Coverage, measured 2026-09-14

`npx tsx scripts/null-video-text.ts --dry-run` now prints a coverage report:

```
coverage: 21,195 video(s) moved, 1,097,222 not yet moved (1.9% of the corpus is in video_text)
sampled 21,195 of them, all three columns:
  all three byte-equal, safe       :     21,195  100.00%
  all three already clear          :          0  0.00%
  DISAGREE, would never be touched :          0  0.00%
```

**Zero disagreements.** Of those 21,195 moved rows, 591 currently hold a non-null `llm_summary`;
the rest never had one. The number that matters is after tonight's mover run, not now.

The report is a **bounded sample** driven off `video_text` with a primary-key join into
`videos`. The obvious form — `from videos v left join video_text vt` with `count(*) filter` —
is a sequential scan of a 1,734 MB heap plus a toast fetch per row; it was written that way,
run once, and cancelled by the 120-second statement timeout. `videos` is never scanned without
an index-backed predicate and a LIMIT.

The verification gate was also relaxed, correctly: it now flags a row only when `videos` holds a
**non-NULL** value that differs from its side copy. A NULL original has nothing to lose, and
once the writers stopped populating those columns a NULL original against a real side copy
became the ordinary state — the old form would have refused to run at all.

## What actually runs tonight

| time | job | what |
|---|---|---|
| 05:30 | `com.mfm.video-scripter-move-video-text` (already installed) | the mover, ~1,097,222 rows |
| 06:00 | `com.mfm.video-scripter-null-video-text` (**install this**) | waits for the mover, then clears `llm_summary` and drops `idx_videos_id_llm_summary` |

The 06:00 job is a wrapper, `scripts/null-video-text-tonight.ts`, and the wrapper is the point.
The mover has ~1,097,222 rows to go and at the measured rate finishes around 05:48 — twelve
minutes of margin, which is a coincidence rather than a margin. The mover stops itself whenever
anything has been running in Postgres for over two minutes, and both the 04:15 fit and the 05:05
packaging counts can overrun into its window. So the wrapper polls for the move to actually
finish, waits until **05:48 ET**, and if it has not finished it **exits 0 having changed nothing**
and tries again the next night. Standing down is the correct outcome: the null-out is
irreversible and not running tonight costs one night of disk. The decision is a pure function,
`lib/app/null-out-gate.ts`, tested against a fixed clock.

The index drop runs in the same step and **after** the null-out, never before: while
`llm_summary` is still populated, dropping `idx_videos_id_llm_summary` would send any straggler
query to a sequential scan of a 1,734 MB heap.

### Install it

```bash
# 1. the trigger has to go first, or the null-out deletes video_text
psql "$DATABASE_SESSION_URL" -v ON_ERROR_STOP=1 -f sql/2026-09-14-retire-video-text-mirror.sql

# 2. rehearse — changes nothing
npx tsx scripts/null-video-text.ts --dry-run
npx tsx scripts/null-video-text-tonight.ts --dry-run --deadline 23:59

# 3. schedule it
cp scripts/launchd/com.mfm.video-scripter-null-video-text.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.mfm.video-scripter-null-video-text.plist

# 4. the morning after
tail -n 100 logs/null-video-text-launchd.log
npx tsx scripts/null-video-text.ts --verify

# 5. remove it once the log ends with "done: llm_summary cleared"
launchctl bootout gui/$UID/com.mfm.video-scripter-null-video-text
rm ~/Library/LaunchAgents/com.mfm.video-scripter-null-video-text.plist
```

Rollback for the index: `sql/rollback/2026-09-14-drop-idx-videos-id-llm-summary.sql`. There is
no rollback for the null-out itself — that is what irreversible means, and it is why the gates
exist.

### The index

`idx_videos_id_llm_summary` is 189 MB with 54,282,547 scans. All of those scans came from one
query shape: `where llm_summary is null and id > $cursor order by id` — the keyset walk that all
seven `workers/llm-summary-*` variants used. That worker is one worker now and it asks
`video_text`, so nothing reads the index any more; and once the column is NULL the index is a
wider copy of `videos_pkey`.

Two more become dead weight the same night and are **not** dropped, because one irreversible
change per night is enough: `idx_videos_llm_summary_null` (27 MB, `where llm_summary is null` —
the predicate becomes true for every row) and `idx_videos_llm_summary_status` (23 MB, `where
llm_summary is not null` — the index becomes empty).

## Step 3 — the repack

**The client exists now, and the extension is installed.**

| precondition | status |
|---|---|
| client binary, version-matched | **met** — `scripts/docker/pg-repack.Dockerfile` builds 1.5.2 from source |
| extension created | **met** — `create extension pg_repack` succeeds as `postgres`, 2026-09-14 |
| step 2 has run | **not met** — and when it does it clears `llm_summary` only |
| free disk for a second copy | **not verified** — 10 GB database on an 18 GB volume; check on the night |

`pg_repack` refuses to run unless the client binary's version matches the installed extension
**exactly**. Supabase offers exactly one version, 1.5.2, and no prebuilt 1.5.2 client exists for
this machine: `brew` has no formula at all, `postgres:15` apt has only 1.5.3, `postgres:15-bookworm`
has 1.5.3 or 1.4.8, and the local Homebrew `psql` is 14.17 against a 15.8 server. So it is built
from source in a container, once.

`create extension pg_repack` **does not need the dashboard and does not need a superuser** — the
`postgres` role on this instance has `usesuper = false` and the statement succeeds anyway. That
contradicts what this runbook said on 2026-09-13.

### Canary, 2026-09-14

Repacked `public.channel_stats` through the exact image and flag set the plist uses:

| | before | after |
|---|---:|---:|
| total size | 2,680 kB | **1,728 kB** (−36 %) |
| rows | 6,683 | 6,683 |

About 12 seconds, most of it spent waiting for one open transaction to finish. Online
throughout; nothing blocked.

One real bug found doing it: the plist passed `-k --no-superuser-check`. `-k` **is** the short
form of `--no-superuser-check`, and `pg_repack` rejects being given both — *"option -k,
--no-superuser-check should be specified only once"*. The job would have failed immediately.
Fixed.

### When to run it on `videos`

**Not on the same night as the null-out**, and not until `description` is cleared. `description`
averages 1,038 bytes of a 2,065-byte row and `metadata` 742; `llm_summary` is 210. Repacking
after an `llm_summary`-only null-out reclaims a few hundred MB of a 3,984 MB table. The
289 remaining direct readers of `description` and `metadata` are the work that unlocks the rest,
and they are the obvious next tranche.

`scripts/launchd/com.mfm.video-scripter-repack-videos.plist` is written, `Disabled`, and carries
the install/run/remove sequence. Interrupting it is safe: it builds a copy and swaps at the end,
so the original is untouched. Clean up after a kill with `drop schema repack cascade;`.

## Expected sizes

| | now | after tonight | after description is cleared + repack |
|---|---:|---:|---:|
| `videos` heap | 1,734 MB | 1,734 MB (dead space inside) | ~400–500 MB |
| `videos` toast | ~890 MB | ~890 MB | ~0 |
| `videos` indexes | 1,352 MB | **1,163 MB** (−189 MB, dropped) | ~1,163 MB |
| `videos` total | 3,984 MB | ~3,795 MB | **~1.8 GB** |

Tonight's visible win is the 189 MB index. The heap saving from `llm_summary` is real but
trapped as dead space until a repack, and a repack is not worth a night for it alone.

`video_text` gains roughly the 2 GB the originals occupy, so the **net** win is the toast and
heap bloat plus a `videos` heap small enough that the sequential scans the nightly export and
the classification workers do stop being the dominant I/O on the instance. That second effect is
the one that matters: it is why the move is worth doing even though the bytes mostly move rather
than disappear.
