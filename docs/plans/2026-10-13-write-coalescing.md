# ChannelSmith write coalescing — implementation-ready

User approved efficiency changes and deployment; R2 cutover remains prohibited. Preserve every observation, all channel coverage, polling schedules, title/thumbnail change detection and scoring cadence.

## Bounded implementation
1. Remove duplicate `track_schedule.last_title_check` standalone writes. `video_title_watch` remains the authoritative evidence; actual title changes still reopen launch tracking. Full repository and live public function/view/matview scans found no consumers of the old checkpoint.
2. Coalesce score-queue updates only while the entry is pending. Add nullable `claimed_at`; scorer atomically marks bounded selected rows before reading inputs. Enqueue always advances generation while claimed. Exact-generation acknowledgement and deferral remain; deferral resets marker. An abandoned marker fails safe by retaining existing update behavior until retried.
3. Keep observation-cache generations and all raw/delta writes unchanged. Those generations bound replay and cannot simply be suppressed. Thumbnail check timestamps still determine existing due schedules; don't drop them casually.

## Acceptance / verification
- Native isolated PostgreSQL test fails on old code because 20 repeated marks rewrite 20 queue tuples, then passes with one pending row and all 21 delta records preserved.
- Exercise enqueue during scoring, stale acknowledgement, producer transaction held across claim, fresh post-claim read, arrival after acknowledgement, crash recovery, deferral, model-rollout priority and earliest due time.
- Title sync retains title/version/authoritative evidence but emits no standalone scheduler update. Actual change still reopens launch lane.
- Preserve canonical dirty operational RSS changes using a scoped patch, not file replacement.
- Real old and new 100-target query plans must remain index-driven on videos (>1 GB), with bounded row output and statement/lock timeouts.
- Deploy schema first, stop/finish old scorer, install new consumer code, then activate coalescing function. Do not activate while an old queue consumer can acknowledge an unmarked claim.
- Verify scheduled scorer and RSS runs, queue-generation safeguards, live function hash and actual before/after row counters. No unnormalized daily savings claims.

## Rollback
Restore exact old enqueue function FIRST (captured in sql/rollback/2026-10-13-score-queue-coalescing.sql), then revert scorer module if necessary. Leave nullable claimed_at in place; old producers ignore it. Restore only scoped RSS/title patches from timestamped backup. No source rows deleted, no data retention changes, no source cadence changes. Bound ALTER lock to 2 seconds; bounded locks must fail rather than queue behind production.
