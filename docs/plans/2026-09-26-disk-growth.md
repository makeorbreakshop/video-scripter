# Disk growth: fix the causes, make silent growth impossible — plan (implementation-ready)

Branch `fix/disk-growth`, worktree `.worktrees/fix-disk-growth`. Production checkout untouched.

## Measured 2026-09-26 07:30 ET (catalog / pg_stats / pgstattuple_approx only)

| relation | total | notes |
|---|---:|---|
| videos | 4,151 MB | heap 1,782 (17 % free), toast 920, 45 indexes 1,449; 17.0 M updates, 14 % HOT |
| rss_samples | 2,950 MB | 97 % live; daily tier keeps ~477 K rows/day **forever** |
| video_text | 2,075 MB | full second copy of description/metadata/llm_summary |
| video_score_history | 1,392 MB | heap 1,280 MB, **92.7 % free**, 94 MB live |
| /data volume | 28.4 GB | 17.1 GB used (60 %); autoscale at 90 % |

## Causes (verified)

1. `null-video-text-tonight.ts` requires `unmoved === 0`; ingest adds 3–30 K unmoved rows/day
   and the job starts at 06:00 against a 05:48 deadline, so it is `skip` by construction —
   12/12 nights. `null-video-text.ts` has the same global gate a second time. The mover itself
   times out (57014) when the unmoved set is sparse: one `limit 2000` anti-join statement walks
   the whole pkey. Ingest (`nightly-ingest`, `drain-touch-queue`, `lib/app/channels.ts`) writes
   text only into `videos`; nothing writes `video_text` at insert.
2. `video_score_history`: ~20 K rows/day steady (9 MB/day), but full rescoring bursts wrote
   3.6 M rows; 14-day DELETE retention leaves the file at its high-water mark.
3. rss/api readings: daily tier has no terminal tier → ~133 MB/day linear, no steady state.
4. Temp spills since 2026-09-04: 77.7 GB over 22 days, largest single statement 555 MB —
   transient; not a disk-trigger risk at 11 GB headroom. Worst live offenders listed in runbook.
5. The egress alarm (`check-supabase-egress.py`) has thrown on every run since 2026-09-10 (403 on
   one project's api-keys) — a silent monitor failure of the same class.

## Work units (test-first)

- U1 null-out: remove global gates; windowed, bounded, per-row-verified batches; per-column
  cleared state from one module; outcome record per run.
- U2 mover: pkey-window batches (bounded per statement); ingest writes `video_text` at insert.
- U3 storage contract registry + evaluation (pure) + live catalog test + daily guard script.
- U4 job-outcome ledger + silent-no-op / stale-heartbeat detector, wired into the jobs.
- U5 score history: reclaim script (dry-run, headroom check, lock_timeout); partition migration
  prepared, not applied.
- U6 readings terminal tier: quantified; policy change prepared for approval.
- U7 docs, skill lesson, shared-memory.

## Approval boundaries

Allowed: VACUUM FULL on video_score_history; running the fixed incremental null-out.
Prepared only: videos rewrite (pg_repack), index drops, partition migration, retention tier change,
LaunchAgent installs.
