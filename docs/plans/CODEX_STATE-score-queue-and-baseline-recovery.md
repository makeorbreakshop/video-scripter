# State: score queue and baseline recovery

## Current position

- Base branch and starting commit: `main` at `b628a41`
- Worktree and feature branch: `.worktrees/codex/fix-score-queue-baseline`, `codex/fix-score-queue-baseline`
- First incomplete work unit: broad regression, independent review, and final handoff

## Completed

- [x] Production diagnosis — read-only database evidence and local worker logs captured in the plan.
- [x] Queue priority RED/GREEN — focused suite passes; live `EXPLAIN (ANALYZE, BUFFERS)` completes in 367 ms warm with 1,909 reads and no large sequential scan. The target video is selected sixth in the priority lane.
- [x] Cache isolation RED/GREEN — partial cache hits are preserved, dependency partition tests pass, and the hourly scorer writes ready targets while deferring only blocked claims.
- [x] UI RED/GREEN — 63 focused assertions pass; design lint passes; rendered desktop and 390×844 checks show truthful delayed copy and the canonical channel baseline.

## Partial or blocked

- [ ] Repository-wide `tsc --noEmit` remains pre-existing red; changed-file filtering reports only the script's pre-existing top-level-await configuration errors.

## Required preflight

```bash
git log --oneline b628a41..HEAD
git status --short
git diff --stat
```
