---
title: Preserve RSS response evidence and use response time for history and freshness
status: implemented-locally
artifact_readiness: verified-local
execution: code
---

## Outcome
Brandon authorized updating the implementation after the response-history and forecast-impact experiments. This supersedes the discard-only proposal. Late RSS readings now fill chart history at a valid HTTP Date, explicitly labeled as an estimated response time. Full raw HTTP receipts are archived independently; delayed evidence cannot replace current tracker state or enter model fitting. No production deployment or historical rewrite has occurred.

## Evidence and limits
The six-video, four-round pilot preserved 24 receipts and produced 21 unique observations. The mismatched cached responses were 449–474 seconds old by HTTP Age; the largest observed Age, 615 seconds, matched the API. Both pilot dips disappear when ordered by response Date. These are selected examples, not fleet incidence. The older September 6 screenshot drops lack response headers, so their cause and timestamp cannot be reconstructed reliably.

HTTP Date identifies response generation/validation, not the exact measurement time of the view counter. Missing/invalid/future Date stays unknown; Age alone does not manufacture a timestamp. No fixed view-count offset or monotonic clamping is applied. The forecast-impact tests establish that an interior target point with fixed endpoints/priors leaves V5 output unchanged, while extending earliest history can change Q/projection. The implementation therefore excludes late backfills from model inputs rather than assuming every insertion is harmless.

## Implemented contract
- The existing poller archives every fetched HTTP receipt: full decoded XML/body, headers, status, channel and fetch time. Network/body-read failures have error receipts. Repeated bodies remain separate receipts. Archive succeeds before this poll's observations are written.
- Archive directory is `RSS_ARCHIVE_DIR` or `logs/rss-responses` in the worker directory. Gzipped JSONL segments expire after 48 hours or when the 8 GiB budget requires oldest-first removal. The newest segment is retained with an explicit warning if oversized. Cleanup runs in the existing poll; no additional scheduled task. This is bounded investigation storage, not a permanent or off-host backup. Copy relevant segments before expiration for a durable investigation.
- Existing `rss_samples` gains time_basis, received_at, archive_ref, model_eligible and conflicted. Legacy rows retain `legacy-fetch`; no fabricated retroactive times. Changed counts and existing heartbeat candidates are retained at valid response Date, or fetch time with an unknown-time label.
- Older-than-watermark RSS responses and responses older than an existing API anchor are chart-only. Unknown clocks and older pending-buffer replays are also model-ineligible. Legacy pending buffers without headers retain compatibility.
- Exact video/time/count duplicates collapse in observations. Conflicting counts at the same timestamp are flagged and withheld from chart/model/scheduler; all variants remain in the archive. Transactional state/sample writes cover rollback, retries and concurrent duplicate writers.
- Per-channel `rss_response_state` tracks the current known response, latest receipt, watermark and cumulative telemetry. Unchanged valid responses advance freshness. Older or unknown responses cannot advance it. Out-of-order pending fetches may add chart history without rolling state or counters backward; counters cover accepted processing order, not a replay census.
- The launch tracker reads the current response clock, not the most recent fetch timestamp. Existing five-minute API launch bursts, RSS-decline/stale/not-newer fallbacks, six-hour crosschecks and API quota limits remain in place. More correctly detected stale RSS may use more of the existing capped API budget.
- Shared model observation SQL and the legacy benchmark exclude model-ineligible/conflicted rows. Replay also censors by received_at, so it cannot see a response before arrival. Observation version is `v5.2-rss-response-time`; formula and fit unchanged. After rebasing onto main, score rows retain the math version from main; the RSS observation tag remains in history provenance. New eligible observations trigger normal bounded refresh; no forced full-corpus rescore was run.
- Chart and public video API carry timestamp provenance. Tooltip says “RSS · estimated response time” or “RSS · response time unknown.” Retention keeps separate daily survivors for model eligibility/conflict classes, preserving model anchors independently of chart history.
- `scripts/rss-freshness-report.ts` reads the bounded state table. It reports raw and non-stale decrease rates with their own denominators, unknown/stale response rates, coverage dates and response-clock delay buckets (<5, 5–15, 15–60, >=60 minutes). Counts cover successful persisted feed responses, including unchanged readings; HTTP errors remain in the raw archive. These are not API-validated accuracy rates.

## Verification
RED failures were reproduced before fixes for delayed persistence, same-timestamp batch collisions, older pending-buffer history, metadata propagation, replay look-ahead, retention eligibility, and delay telemetry. Green verification:
- 59 focused suites / 769 tests pass, including 10 real local PostgreSQL persistence tests. Existing prediction/source-selection tests cover fixed endpoints versus earliest-history changes and five-minute API launch bursts.
- Targeted TypeScript check of changed scripts, UI, API, libraries and tests passes with ES2022. Repository-wide default compilation remains blocked by existing errors (including ES6 target versus top-level-await scripts); it is not claimed clean.
- An initial broader run had one unrelated remote due-select latency assertion fail: 4.5 seconds versus a 500 ms threshold. Functional assertions passed. Final focused run excludes that external timing suite.
- Fresh live RSS-only smoke: six feeds returned HTTP 200; 164,653 raw JSON bytes compressed to 28,503 bytes and restored exactly, including full XML and headers. No API calls or production writes in this smoke.
- Synthetic local PostgreSQL batch: 3,000 responses/observations saved in 122 ms. Scheduler query used both state and RSS primary-key indexes; two-video execution was 0.044 ms. Local timings are not production performance guarantees.
- Actual VideoChartPlot rendered in an isolated browser fixture; the tooltip displays the earlier timestamp and estimate label. Screenshot inspected. Design source lint and git diff whitespace checks pass.

## Rollout handoff
1. Rebased cleanly onto main `1f89f6e`, preserving the cadence V5.2 math and separate model/observation provenance. Post-rebase verification: 59 suites / 782 tests pass, including local PostgreSQL; targeted TypeScript passes.
2. Apply `20260907120000_rss_response_state.sql` before starting any new readers or workers. The worker's database role needs access to the private state table. New columns are metadata defaults, but the ALTER requires a table lock: apply with a bounded lock timeout at rollout.
3. Deploy metadata-aware app/API/scorer/retention readers and the poller/launch tracker together. Preserve the pending journal and worker archive directory. Verify writable archive storage and free space. Existing rows remain legacy; the first new response establishes each channel's initial clock.
4. At the existing cadence, inspect raw archive writes, scheduler source reasons and the read-only freshness report. Save an interval's report and selected raw segments before expiration. This is the remaining step needed to establish representative delay/decrease rates; no monitor was created or started locally.
5. Rollback safety: pause the new RSS poller if necessary and retain the metadata-aware readers; API fallback remains bounded. Do not blindly restore a legacy scorer that would treat chart-only backfills as model inputs. A complete downgrade needs a separately reviewed compatibility/data plan. Keep archived evidence and metadata columns.

## Current boundary
Local implementation and verification are complete. Migration, application/worker deployment, fleet measurement and any retrospective correction of old records have not been performed.
