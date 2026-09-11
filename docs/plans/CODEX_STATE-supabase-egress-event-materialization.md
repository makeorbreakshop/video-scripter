# State: Supabase egress event materialization

## Current position

- Base branch and starting commit: `main` at `0cef7a6`
- Worktree: `/Users/brandoncullum/video-scripter-v2/video-scripter/.worktrees/fix-supabase-egress-materialization`
- Feature branch: `fix-supabase-egress-materialization`
- First incomplete work unit: none; production activation is a separate approval-gated operation

## Completed

- [x] Repository orientation, production root-cause review, and implementation-ready architecture contract.
- [x] Queue/projection slice — v2 raw state, fail-closed cache policy, event-capture migration,
  rollback SQL, and generation-safe queue contracts — 18 focused tests passing.
- [x] Bounded materializer slice — delta-only transaction planner/runner and CLI with hard caps of
  20,000 videos, 50,000 changes, 25 MB cache input, and 25 MB compressed output; these limits are
  sized above the measured 2,500–14,400 changes per RSS poll and bootstrap work cannot starve
  delta work.
- [x] Queue-driven scorer slice — default live selection reads only `score_dirty`, applies age
  cadence, caps work at 1,000/100, requires clean format-2 cache, defers misses, and clears exact
  generations atomically with committed score/history/headline writes; 20 focused tests passing.
- [x] Bootstrap/rollout slice — post-cutover R2-first seeding, explicit/pre-counted raw budgets
  capped at 100 videos/100K rows, exact delta catch-up, and a separate 5,000-ID model rollout lane;
  6 focused tests passing.
- [x] R2 invalidation slice — the drainer reads only clean format-2 compact state plus small
  metadata tables, merges existing R2 history, and clears exact queue generations; 15 focused
  projection/series tests passing.
- [x] Concurrency hardening — claims no longer hold database row locks during external work,
  cache upserts are monotonic, unknown pre-import RSS history is bootstrapped, and update triggers
  preserve delete-before-upsert ordering.
- [x] Supabase tracing — every scheduled pipeline component emits redacted query/run JSON,
  lower-bound returned-byte estimates, and stable operations. `application_name` is set inside
  each transaction because a live acceptance check proved Supavisor replaces startup values.
- [x] Test isolation — default Jest excludes DB/R2 integration suites; production-capable legacy
  parity tests require `ALLOW_PRODUCTION_INTEGRATION_TESTS=1` even when targeted.
- [x] Verification — 1,992 unit tests pass (176 suites; 10 skipped), 14 real local-PostgreSQL
  integration cases pass, all 9 generated LaunchAgent plists lint, scoped strict TypeScript passes,
  and the production build succeeds with network endpoints pinned to localhost.
- [x] Live read-only tracing acceptance — Supabase returned
  `video-scripter:trace-acceptance` from `current_setting('application_name')`; the emitted span
  contained one row, 31 estimated response bytes, and no SQL or credentials.
- [x] Compound — executable egress/test-isolation guards, the canonical incident record, project
  registry, and daily memory now carry the verified design and production-test safety lesson.

## Partial or blocked

- [ ] Production activation is intentionally outside this turn's authority: no worker stop/install,
  database migration/backfill, deployment, push, or spend-cap change.
- [ ] Repository lint remains unavailable: `npm run lint` invokes the removed/interactively
  configured Next lint path; Jest, local PostgreSQL, scoped strict TypeScript, plist lint, and the
  production build are the completed gates.

## Required preflight

```bash
git log --oneline main..HEAD
git status --short
git diff --stat main...HEAD
```
