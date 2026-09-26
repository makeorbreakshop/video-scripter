import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SCHEDULED_JOBS, SCHEDULED_SCRIPTS, heartbeatsFor, unregisteredAgents, installedAgentLabels } from './scheduled-jobs';

const ROOT = path.resolve(__dirname, '..', '..');

describe('the scheduled-job registry', () => {
  it('names only scripts that exist', () => {
    for (const j of SCHEDULED_JOBS) for (const s of j.scripts) expect(fs.existsSync(path.join(ROOT, s))).toBe(true);
  });

  it('gives every job a stdout log and a staleness bound', () => {
    for (const j of SCHEDULED_JOBS) {
      expect(j.log).toMatch(/^logs\/.+-launchd\.log$/);
      expect(j.staleAfterHours).toBeGreaterThan(0);
    }
  });

  it('declares a ledger for every job that can stand down or hold back work', () => {
    // The three jobs whose "success" can be doing nothing: the ones this whole file exists for.
    const ledgered = SCHEDULED_JOBS.filter((j) => j.ledger).map((j) => j.ledger!.job).sort();
    expect(ledgered).toEqual(['move-video-text', 'null-video-text', 'thin-readings']);
  });

  it('turns every job into a file heartbeat, plus a ledger heartbeat where it keeps one', () => {
    const hb = heartbeatsFor(SCHEDULED_JOBS, '/repo');
    expect(hb.filter((h) => h.kind === 'file')).toHaveLength(SCHEDULED_JOBS.length);
    expect(hb.filter((h) => h.kind === 'ledger')).toHaveLength(3);
    const nullOut = hb.find((h) => h.kind === 'file' && h.job.endsWith('null-video-text'))!;
    expect(nullOut).toMatchObject({ path: '/repo/logs/null-video-text-launchd.log', everyHours: 13 });
  });

  it('exposes the scheduled TypeScript entry points to the text-reader sweep', () => {
    expect(SCHEDULED_SCRIPTS).toContain('scripts/rss-poll.ts');
    expect(SCHEDULED_SCRIPTS.every((s) => s.endsWith('.ts'))).toBe(true);
  });
});

describe('a LaunchAgent cannot exist without a declared heartbeat', () => {
  it('reports an installed agent the registry does not know', () => {
    expect(unregisteredAgents(['com.mfm.video-scripter-rss-poll', 'com.mfm.video-scripter-new-thing'], SCHEDULED_JOBS))
      .toEqual(['com.mfm.video-scripter-new-thing']);
  });

  it('reads installed labels from plist file names, ignoring disabled, retired and backup copies', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-'));
    for (const f of ['com.mfm.video-scripter-a.plist', '_disabled.com.mfm.video-scripter-b.plist',
                     'com.mfm.video-scripter-c.plist.retired-20260908', 'com.mfm.video-scripter-d.plist.bak-25',
                     'com.other.plist']) fs.writeFileSync(path.join(dir, f), '');
    expect(installedAgentLabels(dir)).toEqual(['com.mfm.video-scripter-a']);
  });

  const agents = path.join(os.homedir(), 'Library', 'LaunchAgents');
  (fs.existsSync(agents) ? it : it.skip)('THIS machine: every installed video-scripter agent is registered', () => {
    // Fails the moment someone installs a job without saying how it will be watched.
    expect(unregisteredAgents(installedAgentLabels(agents), SCHEDULED_JOBS)).toEqual([]);
  });
});
