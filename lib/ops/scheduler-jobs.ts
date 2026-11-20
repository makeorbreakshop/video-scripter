import type { SchedulerConfig } from './scheduler-core';

// The jobs scripts/scheduler.ts owns. Each was its own LaunchAgent until 2026-11-20; the
// arguments and offsets are carried over unchanged from those plists (ops/launchd/retired/).
//
// Lanes:
//   heavy (1) — the statements that were dying on statement_timeout: the observation cache
//               writers and the nightly fit/export. No two of these ever overlap.
//   db    (2) — bounded database drains: scoring, the feed, the touch queue.
//   net   (3) — YouTube/RSS-bound pollers whose database work is small batched writes.
//
// The two nightlies left the 03:00-04:30 window (daily-ingest 03:00, archive-readings 02:30 and
// the 05:xx text jobs still live there as their own LaunchAgents). export-tables runs first so
// its view_snapshots mirror is fresh before the fit.
export const SCHEDULER_CONFIG: SchedulerConfig = {
  maxConcurrent: 5,
  lanes: { heavy: 1, db: 2, net: 3 },
  exclusiveHolds: ['heavy', 'db'],
  jobs: [
    { name: 'export-tables', script: 'scripts/export-tables.ts', args: [], lane: 'heavy', exclusive: true,
      daily: { hour: 22, minute: 15 }, maxSeconds: 3600 },
    { name: 'score-fit', script: 'scripts/score-videos.ts', args: ['--fit'], lane: 'heavy', exclusive: true,
      daily: { hour: 23, minute: 30 }, maxSeconds: 3600 },

    // --max-videos 3000, not 20000 (2026-11-20): the claim probes video_obs_cache and videos for
    // EVERY due candidate before the 25 MB byte budget trims it to the 1-5 K a run actually takes.
    // Cold on the IO-throttled instance, EXPLAIN ANALYZE at 2,000 took 52.7 s (11,358 reads at
    // ~4.6 ms), so 20,000 could not finish inside the claim's 120 s timeout (57014 on ~40 % of runs).
    { name: 'observation-materializer', script: 'scripts/materialize-observations.ts', lane: 'heavy',
      args: ['--max-videos', '3000', '--max-changes', '50000', '--max-cache-bytes', '25000000',
        '--max-compressed-bytes', '25000000', '--max-seconds', '240'],
      every: { minutes: 5, offsetSeconds: 210 }, maxSeconds: 300 },
    { name: 'observation-bootstrap', script: 'scripts/bootstrap-observation-cache.ts', lane: 'heavy',
      args: ['--max-videos', '500', '--max-changes', '5000', '--raw-video-budget', '500', '--raw-row-budget', '20000',
        '--max-batches', '2', '--max-seconds', '120'],
      every: { minutes: 5, offsetSeconds: 30 }, maxSeconds: 180 },

    { name: 'score', script: 'scripts/score-videos.ts', args: ['--limit', '300', '--max-seconds', '240'], lane: 'db',
      every: { minutes: 5, offsetSeconds: 240 }, maxSeconds: 300 },
    { name: 'feed', script: 'scripts/feed-materialize.ts', args: ['--max-seconds', '240'], lane: 'db',
      every: { minutes: 5, offsetSeconds: 180 }, maxSeconds: 300 },
    { name: 'touch-drain', script: 'scripts/drain-touch-queue.ts', args: ['--max-seconds', '240'], lane: 'db',
      every: { minutes: 5, offsetSeconds: 270 }, maxSeconds: 300 },
    // Publication is disabled inside the script ("0 database reads"); hourly is plenty to notice
    // it being re-enabled, and it was a 270 MB process every 10 minutes for a no-op.
    { name: 'series-drain', script: 'scripts/rebuild-series.ts', lane: 'db',
      args: ['--drain', '--limit', '12000', '--concurrency', '16', '--max-cache-bytes', '25000000', '--max-seconds', '540'],
      every: { minutes: 60, offsetSeconds: 540 }, maxSeconds: 600 },

    { name: 'rss-poll', script: 'scripts/rss-poll.ts', args: ['--max-seconds', '285'], lane: 'net',
      every: { minutes: 5, offsetSeconds: 60 }, maxSeconds: 330 },
    { name: 'launch-track', script: 'scripts/launch-track.ts', args: ['25', '--max-seconds', '240'], lane: 'net',
      every: { minutes: 5, offsetSeconds: 120 }, maxSeconds: 300 },
    { name: 'thumbnail-watch', script: 'scripts/thumbnail-watch.ts', args: ['--max-seconds', '285'], lane: 'net',
      every: { minutes: 5, offsetSeconds: 0 }, maxSeconds: 330 },
    { name: 'verify-shorts', script: 'scripts/verify-shorts.ts', args: ['--limit', '2000', '--max-seconds', '840'], lane: 'net',
      every: { minutes: 15, offsetSeconds: 0 }, maxSeconds: 900 },
    { name: 'track-drain', script: 'scripts/track-drain.ts', args: [], lane: 'net',
      every: { minutes: 15, offsetSeconds: 420 }, maxSeconds: 3000 },
    { name: 'websub-renew', script: 'scripts/websub-subscribe.ts', args: ['--limit', '400'], lane: 'net',
      every: { minutes: 30, offsetSeconds: 600 }, maxSeconds: 600,
      env: { WEBSUB_CALLBACK: 'https://www.channelsmith.com/api/websub' } },
  ],
};
