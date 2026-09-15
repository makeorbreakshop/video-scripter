# State: score queue and baseline recovery

## Current position

- Base branch and starting commit: `main` at `b628a41`
- Worktree and feature branch: `.worktrees/codex/fix-score-queue-baseline`, `codex/fix-score-queue-baseline`
- First incomplete work unit: RED tests for dependency-scoped cache isolation

## Completed

- [x] Production diagnosis — read-only database evidence and local worker logs captured in the plan.
- [x] Queue priority RED/GREEN — focused suite passes; live `EXPLAIN (ANALYZE, BUFFERS)` completes in 367 ms warm with 1,909 reads and no large sequential scan. The target video is selected sixth in the priority lane.

## Partial or blocked

- [ ] Cache isolation and UI state slices remain.

## Required preflight

```bash
git log --oneline b628a41..HEAD
git status --short
git diff --stat
```
