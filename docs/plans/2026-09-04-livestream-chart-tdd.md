# Livestream chart TDD

Base: 8f39086, isolated scoring/v5-evaluation worktree. Local implementation only.

Evidence: Andy Bird API response confirms actual stream start Sep 3 at 11:57:50 AM ET, ending 1:16:22 PM ET. Stored publish was Sep 1, while current API publishedAt is Sep 4. Neither publication value is a valid stream-age origin. Sampler reads statistics.viewCount; concurrentViewers is a distinct metric, never interchangeable.

Acceptance: stored broadcast metadata drives a separate chart origin; preserve publishedAt and raw counts. Exclude pre-start counts from performance chart, retain valid zeros after start. Unknown broadcast start means no invented backfill. Do not show a stored publish-age multiplier or ordinary-video forecast for a broadcast whose model has not been validated. Keep normal video behavior and packaging times. Carry metadata through existing JSONB and provide a bounded explicit refresh path (dry-run default); no DB/schema/deployment effects this turn. The displayed metadata must identify stream start vs publication.

TDD Progress:
- [x] Step 1: Write failing test (RED)
- [x] Step 2: Run test - CONFIRM it fails
- [x] Step 3: Write minimal fix (GREEN)
- [x] Step 4: Run test - CONFIRM it passes
- [x] Step 5: Refactor if needed
- [x] Step 6: Run test - CONFIRM still passes

Verify real loadVideoPage composition with frozen reported video + separately fetched YouTube broadcast metadata, head/metadata consistency, raw observation preservation, count metric distinction, exact-time origin and no inferred pre-live flat line. Render actual chart component + source lint, independent review, scoped regression. No title-keyword classification and no invented livestream-specific multiplier.

Evidence logs: /tmp/livestream-tdd-red.log (2 failures), /tmp/livestream-tdd-green.log (2 passes); metadata retention test failed before write-helper integration; reviewer edge cases each failed before their fixes. Final broader regression: 286 pass, six existing DB-dependent skips. Desktop/mobile browser gate + source lint passed; independent review cleared all findings. Detailed receipt: docs/audits/2026-09-04-livestream-tdd.md. Local complete; no production actions.
