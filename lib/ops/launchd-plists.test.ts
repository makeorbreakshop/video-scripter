import fs from 'node:fs';
import path from 'node:path';
import { SCHEDULER_CONFIG } from './scheduler-jobs';
import { meterEnvFor } from './scheduled-jobs';

// The LaunchAgents are tracked in launchd/ (installed copies live in ~/Library/LaunchAgents).
const dir = path.resolve(__dirname, '../../launchd');
const active = fs.readdirSync(dir).filter((f) => f.endsWith('.plist'));
const read = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8');

describe('tracked LaunchAgents', () => {
  it.each(active)('%s launches node directly from the Homebrew symlink', (file) => {
    const xml = read(file);
    expect(xml).not.toMatch(/Cellar/);
    expect(xml).not.toMatch(/<string>[^<]*\bnpx\b/);
  });

  it('leaves no job both in the scheduler and in its own active LaunchAgent', () => {
    for (const job of SCHEDULER_CONFIG.jobs) {
      expect(active).not.toContain(`com.mfm.video-scripter-${job.name}.plist`);
      expect(fs.existsSync(path.join(dir, 'retired', `com.mfm.video-scripter-${job.name}.plist`))).toBe(true);
    }
  });

  it('runs the scheduler as a single KeepAlive agent', () => {
    const xml = read('com.mfm.video-scripter-scheduler.plist');
    expect(xml).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
    expect(xml).toContain('<string>scripts/scheduler.ts</string>');
  });
});

describe('tracked LaunchAgents carry the egress meter', () => {
  it.each(active)('%s preloads the meter and names its job', (file) => {
    const label = file.replace(/\.plist$/, '');
    const want = meterEnvFor(label, '/Users/brandoncullum/video-scripter-v2/video-scripter');
    const xml = read(file);
    expect(xml).toContain(`<string>${want.NODE_OPTIONS}</string>`);
    expect(xml).toContain(`<string>${want.EGRESS_JOB}</string>`);
  });
});
