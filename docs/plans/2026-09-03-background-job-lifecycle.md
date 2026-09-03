---
title: Bound local background jobs without interrupting intentional backfills
status: complete
artifact_readiness: implementation-ready
execution: code
---

## Outcome

Keep the Mac responsive while ChannelSmith background work continues. Prevent two copies of the
same workload from overlapping, bound scheduled runs to their launch interval, and preserve the
two intentional `verify-shorts` backfills as distinct resumable workloads.

## Non-goals and protected behavior

- Do not stop or merge the intentional default and `--only-flagged` Shorts backfills.
- Do not kill active named `agent-browser` sessions. The existing global browser reaper remains
  responsible for managed-browser trees older than its two-hour safety floor.
- Do not attribute PostgreSQL `ProcessInterrupts` to launchd: the retained error was an old
  statement-timeout failure, and the current watcher already disables that timeout.
- Do not push, deploy, or alter production data.

## Prior Learnings

- The same machine has had runaway Vitest fan-out at least three times. The current JetSweep
  Vitest configuration has no worker cap.
- launchd does not start a second copy of one running label, but direct/manual invocations can
  overlap the scheduled label.
- Async cleanup cannot be made reliable from Node's `exit` event. Cooperative signals and a
  bounded hard-stop fallback are required.

## Key Decisions

- Use an atomic lock directory with owner PID plus a random ownership token. Reclaim only a lock
  whose owner is demonstrably dead; never use a bare process-name kill.
- Give `verify-shorts:default` and `verify-shorts:flagged` separate identities. This blocks the
  scheduled default run behind the real default backfill while allowing the flagged repair to
  continue.
- Scheduled jobs receive `--max-seconds`; manual backfills remain unbounded unless explicitly
  given a budget.
- The five 5-minute jobs retain their cadence but use minute offsets 0–4, avoiding synchronized
  runtime and cold-start bursts after login or reload.
- Keep the existing Puppeteer `try/finally` cleanup and global two-hour browser reaper; add no
  duplicate process killer for currently active browser sessions.

## Acceptance Contract

- A second live holder of the same job identity exits successfully without running work.
- A dead holder's lock is reclaimed, and an old holder cannot release a new holder's lock.
- SIGTERM releases the lease; a deadline first aborts cooperatively, then invokes the hard stop
  only after its grace period.
- Every scheduled ChannelSmith entrypoint uses the lifecycle guard and has a budget below its
  LaunchAgent interval.
- Both Shorts backfills remain alive after installation; the 15-minute default LaunchAgent skips
  while the manual default backfill owns the lease.
- JetSweep Vitest runs at no more than two workers through the root configuration.

## Work Units

- [x] Prove lease, stale recovery, signal, deadline, wiring, and Vitest-budget failures RED.
- [x] Implement the lifecycle primitive and wire the six scheduled entrypoints.
- [x] Track and install reproducible LaunchAgent definitions with run budgets and background nice.
- [x] Add the JetSweep Vitest worker cap.
- [x] Restart the two Shorts backfills under their distinct guarded identities and verify the
      scheduled default copy skips.
- [x] Run focused tests, targeted TypeScript, source/config checks, and a live process smoke.
- [x] Review and compound the recurring failure into executable contracts.

## Verification Handoff

- `npm test -- --runInBand lib/nightly/job-lifecycle.test.ts lib/nightly/background-job-contract.test.ts`
- Targeted `npx tsc --noEmit` over the changed lifecycle and background-job files. The whole-repo
  typecheck has a large unrelated pre-existing error backlog and is recorded as non-blocking.
- Focused JetSweep Vitest config test.
- Live `launchctl`/`ps` check: one default backfill, one flagged backfill, no extra scheduled
  default worker, and no unnamed stale browser trees over the reaper threshold.

## Risks and Rollback

- A bad lock could suppress work. Roll back by unloading the updated plists and restoring the
  prior direct commands; dead-owner recovery and token ownership are regression-tested.
- A budget could repeatedly stop before useful progress. Keep existing cursor/checkpoint behavior,
  log budget exhaustion, and set budgets from measured run times rather than arbitrary thresholds.
- Current uncommitted semantic work is unrelated and must remain untouched.

## Stop Conditions and Budgets

- At most two attempts at one failing implementation boundary before re-diagnosis.
- No full Jest or Vitest sweep until focused process tests pass.
- No production deployment, push, browser-session termination, or database cleanup.
