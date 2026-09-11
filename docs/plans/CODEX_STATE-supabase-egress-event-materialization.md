# State: Supabase egress event materialization

## Current position

- Base branch and starting commit: `main` at `0cef7a6`
- Worktree: `/Users/brandoncullum/video-scripter-v2/video-scripter/.worktrees/fix-supabase-egress-materialization`
- Feature branch: `fix-supabase-egress-materialization`
- First incomplete work unit: operational packaging and verification

## Completed

- [x] Repository orientation, production root-cause review, and implementation-ready architecture contract.
- [x] Queue/projection slice — v2 raw state, fail-closed cache policy, event-capture migration,
  rollback SQL, and generation-safe queue contracts — 18 focused tests passing.
- [x] Bounded materializer slice — delta-only transaction planner/runner and CLI with hard caps of
  100 videos, 5,000 changes, and 5 MB compressed output; bootstrap work cannot starve delta work.
- [x] Queue-driven scorer slice — default live selection reads only `score_dirty`, applies age
  cadence, caps work at 1,000/100, requires clean format-2 cache, defers misses, and clears exact
  generations atomically with committed score/history/headline writes; 20 focused tests passing.
- [x] Bootstrap/rollout slice — post-cutover R2-first seeding, explicit/pre-counted raw budgets
  capped at 100 videos/100K rows, exact delta catch-up, and a separate 5,000-ID model rollout lane;
  6 focused tests passing.
- [x] R2 invalidation slice — the drainer reads only clean format-2 compact state plus small
  metadata tables, merges existing R2 history, and clears exact queue generations; 15 focused
  projection/series tests passing.

## Partial or blocked

- [ ] Production activation is intentionally outside this turn's authority: no worker stop/install,
  database migration/backfill, deployment, push, or spend-cap change.

## Required preflight

```bash
git log --oneline main..HEAD
git status --short
git diff --stat main...HEAD
```
