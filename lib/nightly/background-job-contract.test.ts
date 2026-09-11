import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const guardedScripts = [
  'verify-shorts.ts',
  'thumbnail-watch.ts',
  'rss-poll.ts',
  'launch-track.ts',
  'feed-materialize.ts',
  'drain-touch-queue.ts',
  'materialize-observations.ts',
  'bootstrap-observation-cache.ts',
  'rebuild-series.ts',
];
const scheduledScripts = [
  ...guardedScripts.slice(0, -1),
  'score-videos.ts',
  guardedScripts.at(-1)!,
];

describe('scheduled background job wiring', () => {
  it.each(guardedScripts)('%s enters through the shared lifecycle guard', (file) => {
    const source = fs.readFileSync(path.join(root, 'scripts', file), 'utf8');
    expect(source).toContain('startManagedJob(');
  });

  it('tracks every installed job with a sub-interval run budget', async () => {
    const { BACKGROUND_JOBS } = await import('../../scripts/launchd/background-jobs');
    const names = BACKGROUND_JOBS.map((job) => job.script);
    expect(names).toEqual(scheduledScripts);
    for (const job of BACKGROUND_JOBS) {
      expect(job.maxSeconds).toBeGreaterThan(0);
      expect(job.maxSeconds).toBeLessThan(job.intervalSeconds);
      expect(job.nice).toBeGreaterThan(0);
    }
    const fiveMinuteJobs = BACKGROUND_JOBS.filter((job) => job.intervalSeconds === 300);
    const starts = fiveMinuteJobs.map((job) => `${job.minuteOffset}:${job.secondOffset ?? 0}`);
    expect(new Set(starts).size).toBe(starts.length);
    expect(starts.sort()).toEqual(['0:0', '0:30', '1:0', '2:0', '3:0', '3:30', '4:0', '4:30']);
  });

  it('schedules bounded observation, score, and R2 drains', async () => {
    const { BACKGROUND_JOBS } = await import('../../scripts/launchd/background-jobs');
    const observation = BACKGROUND_JOBS.find((job) => job.script === 'materialize-observations.ts');
    const bootstrap = BACKGROUND_JOBS.find((job) => job.script === 'bootstrap-observation-cache.ts');
    const score = BACKGROUND_JOBS.find((job) => job.script === 'score-videos.ts');
    const series = BACKGROUND_JOBS.find((job) => job.script === 'rebuild-series.ts');
    expect(observation?.args).toEqual([
      '--max-videos', '20000', '--max-changes', '50000', '--max-cache-bytes', '25000000',
      '--max-compressed-bytes', '25000000',
    ]);
    expect(bootstrap?.args).toEqual([
      '--max-videos', '25', '--max-changes', '5000',
      '--raw-video-budget', '25', '--raw-row-budget', '10000',
    ]);
    expect(bootstrap?.intervalSeconds).toBe(300);
    expect(score?.args).toEqual(['--limit', '100']);
    expect(series?.args).toEqual([
      '--drain', '--limit', '12000', '--concurrency', '16', '--max-cache-bytes', '25000000',
    ]);
    expect(series?.intervalSeconds).toBe(600);
    expect(fs.readFileSync(path.join(root, 'scripts', 'score-videos.ts'), 'utf8')).toContain('runScoringWorker(');
  });

  it('renders the guard budget and lower-priority scheduling into every LaunchAgent', async () => {
    const { BACKGROUND_JOBS } = await import('../../scripts/launchd/background-jobs');
    const { renderLaunchAgent } = await import('../../scripts/launchd/background-job-plist');
    for (const job of BACKGROUND_JOBS) {
      const plist = renderLaunchAgent(job, '/tmp/video-scripter');
      expect(plist).toContain(`<string>scripts/${job.script}</string>`);
      expect(plist).toContain(`<string>${job.maxSeconds}</string>`);
      expect(plist).toContain(`<integer>${job.nice}</integer>`);
      expect(plist).toContain('<string>Background</string>');
      expect(plist).toContain('<true/>');
      expect(plist).toContain('<key>StartCalendarInterval</key>');
      expect(plist).not.toContain('<key>StartInterval</key>');
    }
  });
});
