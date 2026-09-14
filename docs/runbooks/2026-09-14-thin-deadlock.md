# Thinning, the delta queues, and the deadlock — 2026-09-14

Follows `docs/runbooks/2026-09-08-columnar-readings.md` and
`~/shared-memory/knowledge/projects/video-scripter/2026-09-11-supabase-egress-root-cause.md`.

## What happened

The manual thin run started 08:28 ET died on its first day:

```
2026-09-14T12:31:53Z THINNED rss 2026-09-03 (hourly): 286,346 → 286,346 rows (−0)
error: deadlock detected
  PL/pgSQL function enqueue_observation_changes(jsonb) line 6 at SQL statement
  PL/pgSQL function queue_rss_deletes() line 3 at PERFORM
exit 1
```

Two transactions wanted the same rows in `obs_cache_dirty` / `score_dirty` / `series_dirty`:

- the **RSS poller**, inserting into `rss_samples`, reaching them through
  `queue_rss_upserts()` in `video_id` order;
- the **thinning delete**, reaching them through `queue_rss_deletes()` in `ctid` order,
  because the delete identified its rows by physical position.

Different orders over a shared lock set is a deadlock waiting for enough rows, and 20,000 rows
per statement was enough.

## The design question: should thinning deletes enqueue observation deltas at all?

**No. They must not.** Three independent reasons, any one of which is sufficient.

### 1. A thinned row is not a correction

`lib/readings/retention.ts` does not choose survivors for tidiness. It keeps

- the **last** reading of each `(video, bucket)`, and
- the **first** reading of each `(video, UTC day, views > 0)`,

because `lib/scoring/core.ts growthExponent()` is
`log(last.views / first.views) / log((last.day+1) / (first.day+1))` — it reads a video's earliest
and latest reading and nothing between them, and it drops non-positive readings before taking the
first. The survivor set is chosen so that every value a consumer can compute is unchanged.

That is measured, not asserted. `scripts/verify-archive.ts` applies the policy at a clock shifted
+40 days against real production data: **0 of 200 videos changed a score-affecting `qResidual`
bin, three runs running**, and the drawn chart line moved **0.000 %**.

So the obs cache, the scorer and the series files have nothing to learn from a thinning delete.
Rebuilding any of them from the survivors produces the same answer it would have produced from
the full day. The delta would carry no information.

### 2. Propagating would re-create the egress incident

The queue does not just log. `enqueue_observation_changes()` appends to
`observation_change_log` and then upserts into `obs_cache_dirty`, `score_dirty` **and**
`series_dirty`. Thinning is about to delete ~9.4 M rows. That would mean:

- **9.4 M rows appended to `observation_change_log`** — growing the database during a
  disk-pressure emergency whose entire purpose is to shrink it;
- **essentially the whole live corpus marked dirty in all three queues at once**, forcing a full
  observation-cache re-materialisation and a full re-score.

A full corpus re-materialisation reading raw histories back out through Supavisor is exactly the
unbounded traffic the 2026-09-11 rework exists to prevent (98.6 % cache miss rate, 17 GB of
Shared Pooler Egress in 28 hours). **The disk fix would re-create the egress incident.** Sizing
it is the argument against it: there is no batch size at which re-scoring 1.1 M videos to learn
nothing is worth doing.

### 3. It deadlocks

Covered above. Suppressing the delete deltas removes the shared lock set entirely, which is the
real fix; key-order deletes, `lock_timeout` and retry are the defence behind it.

## What was changed

| change | where |
|---|---|
| Delete identifies and orders rows by the **primary key** `(video_id, at)`, not `ctid`, so the thinner and the writers take locks in the same order | `lib/readings/sql.ts thinBatchSql()` |
| Delete deltas suppressed for the thinning transaction | `lib/readings/sql.ts THIN_SUPPRESS_DELTAS_SQL`, `supabase/migrations/20260914140000_thin_delta_suppression.sql` |
| `set local lock_timeout = 5s` so a blocked batch gives way instead of holding its locks for the full 600 s statement timeout | `lib/readings/sql.ts thinTransactionPreamble()` |
| Retry on `40P01` / `55P03` / `40001`, four bounded attempts, and nothing else | `lib/readings/thin-safety.ts` |
| 5,000 rows per thinning statement instead of 20,000 | `READING_RETENTION.thinBatchRows` |
| One day at a time, and a day already at its tier is skipped without being walked | `lib/readings/chain.ts decideThin()` |

### Why a session GUC, not `alter table … disable trigger`

`alter table rss_samples disable trigger queue_rss_samples_delete` takes **ACCESS EXCLUSIVE** on
a 2.2 GB table that the RSS poller writes to every few minutes. It would block every live writer
for the length of the thinning run, and — worse — it is a *global, persistent* change: a crashed
session leaves the trigger disabled and the next real delete silently stops propagating.

`set local channelsmith.suppress_observation_deltas = 'on'` is transaction-scoped, takes no lock,
cannot outlive a rollback, and is the one form Supavisor's `:6543` transaction pooler honours
(`lib/admin/db.ts` — a plain `SET` on a pooled connection lands after the statements it was meant
to protect). The trigger functions call `public.thin_deltas_suppressed()` and return early.

Only `queue_rss_deletes()` and `queue_sample_deletes()` are guarded — the two tables the
retention job touches. Inserts, updates and every snapshot path are untouched: **real evidence
changes must still propagate**, and nothing but the thinner ever sets the flag.

## Pinned by

- `lib/readings/thin-safety.test.ts` — the delete keys and orders on the primary key; the flag is
  a `set local` GUC and never `disable trigger`; the preamble bounds the lock wait; only lock
  errors retry.
- `lib/readings/chain.test.ts` — a refused shrink is not a failure; an unchanged verified day is
  not re-archived; a day already at its tier is not re-walked.

## Rollback

`sql/rollback/2026-09-14-thin-delta-suppression.sql` restores the 2026-09-11 trigger bodies. The
ledger columns are additive and are left in place.
