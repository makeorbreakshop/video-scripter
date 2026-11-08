import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { alertQdrantOutage, OUTAGE_ALERT_INTERVAL_MS, shouldAlert } from './outage-alert';

describe('shouldAlert', () => {
  const now = new Date('2026-11-08T05:00:00Z');
  it('alerts when never alerted or the state is unreadable', () => {
    expect(shouldAlert(null, now)).toBe(true);
    expect(shouldAlert(new Date('garbage'), now)).toBe(true);
  });
  it('stays quiet inside the interval and alerts again after it', () => {
    expect(shouldAlert(new Date(now.getTime() - OUTAGE_ALERT_INTERVAL_MS + 1), now)).toBe(false);
    expect(shouldAlert(new Date(now.getTime() - OUTAGE_ALERT_INTERVAL_MS), now)).toBe(true);
  });
});

describe('alertQdrantOutage', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qdrant-alert-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('notifies and files a Pulse failure once, then rate-limits hourly retries', () => {
    let t = new Date('2026-11-08T05:00:00Z');
    const notify = jest.fn(); const pulse = jest.fn();
    const deps = { statePath: path.join(dir, 'nested', 'last'), now: () => t, notify, pulse };
    expect(alertQdrantOutage('Unable to reach Qdrant', deps)).toBe(true);
    expect(notify).toHaveBeenCalledWith('ChannelSmith Qdrant is down', expect.stringContaining('Unable to reach Qdrant'));
    expect(pulse).toHaveBeenCalledTimes(1);
    t = new Date(t.getTime() + 60 * 60_000);
    expect(alertQdrantOutage('Unable to reach Qdrant', deps)).toBe(false);
    t = new Date(t.getTime() + OUTAGE_ALERT_INTERVAL_MS);
    expect(alertQdrantOutage('Unable to reach Qdrant', deps)).toBe(true);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('never throws when the notifier fails', () => {
    const deps = { statePath: path.join(dir, 'last'), now: () => new Date(), notify: () => { throw new Error('no gui'); }, pulse: jest.fn() };
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(alertQdrantOutage('x', deps)).toBe(false);
    spy.mockRestore();
  });
});
