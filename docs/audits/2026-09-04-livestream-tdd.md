# Livestream chart: verified timing, TDD repair

## Finding

The reported Andy Bird video is a completed livestream. A read-only YouTube videos.list lookup on September 4 at 4:49 PM ET returned:

- Actual start: September 3, 11:57:50 AM ET.
- Actual end: September 3, 1:16:22 PM ET.
- Scheduled start: September 3, noon ET.
- Current API publication: September 4, 2:10:27 AM ET.
- Stored publication in the original fixture: September 1, 12:23:51 PM ET.
- Current duration: 1h13m34s; liveBroadcastContent: none.

The stream's actual start is distinct from both publication values. The original flat history included pre-stream time. The frozen RSS zero at September 3, 11:59:37 AM ET occurred after the stream began and remains a valid recorded zero; it is not erased to make the plot look better. The later rise is preserved.

YouTube documents actualStartTime separately and returns liveStreamingDetails for completed broadcasts. concurrentViewers means people watching concurrently and is distinct from cumulative statistics.viewCount. Our sampler and first-sample writer use the latter. This investigation does not prove every reported view count is accurate, or establish equivalence between RSS and processed YouTube analytics.

Sources: https://developers.google.com/youtube/v3/docs/videos#liveStreamingDetails and the captured `2026-09-04-andy-live-metadata.json` in this directory. One API lookup; no database operations.

## Local implementation

- Use existing videos.metadata JSONB to retain broadcast start/end/schedule separately. Current ingest detail requests include liveStreamingDetails and the shared write helper merges broadcast fields without altering published_at, raw counts or unrelated metadata. No schema migration.
- Load head and body with the same broadcast interpretation. Actual stream start drives the chart and displayed stream age; original publication is retained. Archived streams remain identifiable when their current broadcast status is none.
- Keep only post-start actuals in the stream performance view; no fabricated origin or pre-live backfill. For unknown start, retain recorded points even when publication moved later; label stream age unknown and preserve the publication label.
- Show recorded views only for broadcasts. Suppress the stored publish-age score, comparison and ordinary-video forecast in this page until a stream-appropriate model is validated. Other product surfaces and production score rows are unchanged.
- Keep packaging windows that cross stream start and clip to the chart. Earlier point changes remain outside its domain.
- Label the latest reading once: no duplicate forecast endpoint when no forecast exists.
- Malformed broadcast details cannot mark a regular upload as live. Valid zero cumulative counts remain distinct from concurrent viewers.

## Red → green evidence

1. Real loadVideoPage fixture plus captured stream metadata: two failures before implementation (missing stream origin and unknown-start treatment); both pass after fix.
2. Metadata retention through ingestWrites: failed because no metadata write existed; passes after integration.
3. Reviewer probes became failing regressions: crossing-start packaging window dropped; earlier real reading discarded when publication moved later. Both pass after fixes.
4. Unknown-start publication label: failed with recorded timestamp instead of publication; passes after correcting head/body semantics.
5. Four malformed metadata inputs failed before plain-object guards; now pass.
6. Real browser endpoint-label assertion failed with two labels instead of one; passes after requiring a forecast endpoint to be an actual forecast.

Final scoped run: 15 suites passed, 286 tests passed; two existing database-dependent suites / six tests skipped. Independent reviewer reran six suites / 62 tests and found no remaining material in-scope issues. Source design lint passes. Repository-wide tsc remains red on existing errors (including script top-level-await configuration); no final diagnostics name the new/changed app, component or helper modules. The initial new dotenv type error was fixed.

## Render and repeat

`node scripts/check-livestream-preview.cjs` builds and serves the real chart component on an ephemeral local port, uses the frozen output of loadVideoPage from the regression fixture, checks stream text/no old score/no projection/single current label, captures desktop and 390px mobile, and closes browser/server. Does not load credentials or database modules.

Preview source and saved composition: `docs/audits/livestream-preview/`. This verifies the real component with fixture-backed composition, not an authenticated production page. Screenshots: `2026-09-04-livestream-desktop.png`, `2026-09-04-livestream-mobile.png`. Render review verified chronology, distinct observed data, readable labels and no horizontal overflow; no theme/layout redesign.

Focused tests:

```sh
npx jest lib/app/livestream-chart.test.ts lib/ingest/broadcast-metadata.test.ts lib/app/packaging-groups.test.ts --runInBand
node scripts/check-livestream-preview.cjs
npx tsx scripts/apply-broadcast-metadata.ts --file docs/audits/2026-09-04-andy-live-metadata.json
```

The final command is a dry-run by default and was verified without a database connection. Explicit --write would merge this one captured video's metadata; it was NOT executed. Existing archived videos need verified metadata refresh when releasing the fix. Older unrelated import paths that overwrite entire metadata blobs still require preservation work before claiming universal ingestion coverage.

## Release boundary

All changes are local in scoring/v5-evaluation based on 8f39086. No production data, score model, scheduler, canonical checkout, push, merge or deployment changes. The test suite is the regression prevention mechanism; broad livestream scoring/calibration remains separate work. The old 0.8× is withheld here, not silently recalculated with normal-upload priors.

## Compact presentation correction
Brandon rejected the standalone livestream explanation and duplicate chart heading as contrary to the design rules. Removed both, including the empty verdict container. Stream context remains in the existing date line, with secondary detail in its title attribute. The corrected header test failed on the old paragraph before implementation, then passed; 21 focused tests pass. The browser regression now rejects visible model-explanation copy/repeated headings and checks that chart controls follow compact metadata. Desktop/mobile screenshots refreshed and inspected; source lint passes. This replaces the verbose presentation in the first livestream preview.
