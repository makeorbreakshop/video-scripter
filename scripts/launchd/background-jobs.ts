export interface BackgroundJob {
  label: string;
  script: string;
  args: string[];
  intervalSeconds: number;
  minuteOffset: number;
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
    maxSeconds: 240,
    nice: 10,
    stdout: 'touch-drain-launchd.log',
    stderr: 'touch-drain-launchd.err.log',
  },
];
