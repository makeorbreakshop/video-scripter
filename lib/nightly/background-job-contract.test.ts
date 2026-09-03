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
];

describe('scheduled background job wiring', () => {
  it.each(guardedScripts)('%s enters through the shared lifecycle guard', (file) => {
    const source = fs.readFileSync(path.join(root, 'scripts', file), 'utf8');
    expect(source).toContain('startManagedJob(');
  });

  it('tracks every installed job with a sub-interval run budget', async () => {
    const { BACKGROUND_JOBS } = await import('../../scripts/launchd/background-jobs');
    const names = BACKGROUND_JOBS.map((job) => job.script);
    expect(names).toEqual(guardedScripts);
    for (const job of BACKGROUND_JOBS) {
      expect(job.maxSeconds).toBeGreaterThan(0);
      expect(job.maxSeconds).toBeLessThan(job.intervalSeconds);
      expect(job.nice).toBeGreaterThan(0);
    }
    const fiveMinuteJobs = BACKGROUND_JOBS.filter((job) => job.intervalSeconds === 300);
    expect(fiveMinuteJobs.map((job) => job.minuteOffset).sort()).toEqual([0, 1, 2, 3, 4]);
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
