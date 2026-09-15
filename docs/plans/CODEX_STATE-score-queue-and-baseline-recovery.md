# State: score queue and baseline recovery

## Current position

- Base branch and starting commit: `main` at `b628a41`
- Worktree and feature branch: `.worktrees/codex/fix-score-queue-baseline`, `codex/fix-score-queue-baseline`
- First incomplete work unit: RED tests for the unscored video-page baseline and truthful state copy

## Completed

- [x] Production diagnosis — read-only database evidence and local worker logs captured in the plan.
- [x] Queue priority RED/GREEN — focused suite passes; live `EXPLAIN (ANALYZE, BUFFERS)` completes in 367 ms warm with 1,909 reads and no large sequential scan. The target video is selected sixth in the priority lane.
- [x] Cache isolation RED/GREEN — partial cache hits are preserved, dependency partition tests pass, and the hourly scorer writes ready targets while deferring only blocked claims.

## Partial or blocked

- [ ] UI state slice remains.
- [ ] Repository-wide `tsc --noEmit` remains pre-existing red; changed-file filtering reports only the script's pre-existing top-level-await configuration errors.

## Required preflight

```bash
git log --oneline b628a41..HEAD
git status --short
git diff --stat
```
