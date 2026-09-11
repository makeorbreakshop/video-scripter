export interface BackgroundJob {
  label: string;
  script: string;
  args: string[];
  intervalSeconds: number;
  minuteOffset: number;
  secondOffset?: number;
  maxSeconds: number;
  nice: number;
  stdout: string;
  stderr: string;
}

export const BACKGROUND_JOBS: BackgroundJob[] = [
  {
    label: 'com.mfm.video-scripter-verify-shorts',
    script: 'verify-shorts.ts',
    args: ['--limit', '2000'],
    intervalSeconds: 900,
    minuteOffset: 0,
    maxSeconds: 840,
    nice: 10,
    stdout: 'verify-shorts-launchd.log',
    stderr: 'verify-shorts-launchd.err.log',
  },
  {
    label: 'com.mfm.video-scripter-thumbnail-watch',
    script: 'thumbnail-watch.ts',
    args: [],
    intervalSeconds: 300,
    minuteOffset: 0,
    maxSeconds: 285,
    nice: 10,
    stdout: 'thumbnail-watch-launchd.log',
    stderr: 'thumbnail-watch-launchd.err.log',
  },
  {
    label: 'com.mfm.video-scripter-rss-poll',
    script: 'rss-poll.ts',
    args: [],
    intervalSeconds: 300,
    minuteOffset: 1,
    maxSeconds: 285,
    nice: 10,
    stdout: 'rss-poll-launchd.log',
    stderr: 'rss-poll-launchd.err.log',
  },
  {
    label: 'com.mfm.video-scripter-launch-track',
    script: 'launch-track.ts',
    args: ['25'],
    intervalSeconds: 300,
    minuteOffset: 2,
    maxSeconds: 240,
    nice: 10,
    stdout: 'launch-track-launchd.log',
    stderr: 'launch-track-launchd.err.log',
  },
  {
    label: 'com.mfm.video-scripter-feed',
    script: 'feed-materialize.ts',
    args: [],
    intervalSeconds: 300,
    minuteOffset: 3,
    maxSeconds: 240,
    nice: 10,
    stdout: 'feed-launchd.log',
    stderr: 'feed-launchd.err.log',
  },
  {
    label: 'com.mfm.video-scripter-touch-drain',
    script: 'drain-touch-queue.ts',
    args: [],
    intervalSeconds: 300,
    minuteOffset: 4,
    secondOffset: 30,
    maxSeconds: 240,
    nice: 10,
    stdout: 'touch-drain-launchd.log',
    stderr: 'touch-drain-launchd.err.log',
  },
  {
    label: 'com.mfm.video-scripter-observation-materializer',
    script: 'materialize-observations.ts',
    args: [
      '--max-videos', '20000',
      '--max-changes', '50000',
      '--max-cache-bytes', '25000000',
      '--max-compressed-bytes', '25000000',
    ],
    intervalSeconds: 300,
    minuteOffset: 3,
    secondOffset: 30,
    maxSeconds: 240,
    nice: 10,
    stdout: 'observation-materializer-launchd.log',
    stderr: 'observation-materializer-launchd.err.log',
  },
  {
    // Slow self-healing for legacy videos discovered after cutover. The preflight count aborts
    // before a raw read above 100 videos or 20k narrow rows; at twelve runs/hour that also bounds
    // the recurring raw-read rate while ordinary event materialization remains raw-free.
    label: 'com.mfm.video-scripter-observation-bootstrap',
    script: 'bootstrap-observation-cache.ts',
    args: [
      '--max-videos', '100',
      '--max-changes', '5000',
      '--raw-video-budget', '100',
      '--raw-row-budget', '20000',
    ],
    intervalSeconds: 300,
    minuteOffset: 0,
    secondOffset: 30,
    maxSeconds: 120,
    nice: 15,
    stdout: 'observation-bootstrap-launchd.log',
    stderr: 'observation-bootstrap-launchd.err.log',
  },
  {
    label: 'com.mfm.video-scripter-score',
    script: 'score-videos.ts',
    args: ['--limit', '100'],
    intervalSeconds: 300,
    minuteOffset: 4,
    maxSeconds: 240,
    nice: 10,
    stdout: 'score-launchd.log',
    stderr: 'score-launchd.err.log',
  },
  {
    label: 'com.mfm.video-scripter-series-drain',
    script: 'rebuild-series.ts',
    args: ['--drain', '--limit', '12000', '--concurrency', '16', '--max-cache-bytes', '25000000'],
    intervalSeconds: 600,
    minuteOffset: 9,
    maxSeconds: 540,
    nice: 10,
    stdout: 'series-drain-launchd.log',
    stderr: 'series-drain-launchd.err.log',
  },
];
