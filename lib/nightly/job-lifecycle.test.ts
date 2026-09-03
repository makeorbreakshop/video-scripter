import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireJobLease, createRunBudget, startManagedJob } from './job-lifecycle';

describe('background job lifecycle', () => {
  let lockRoot: string;

  beforeEach(() => {
    lockRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'channelsmith-job-test-'));
  });

  afterEach(() => {
    jest.useRealTimers();
    fs.rmSync(lockRoot, { recursive: true, force: true });
  });

  it('allows only one live owner for a workload', () => {
    const first = acquireJobLease({ name: 'verify-shorts:default', lockRoot });
    const second = acquireJobLease({ name: 'verify-shorts:default', lockRoot });

    expect(first.acquired).toBe(true);
    expect(second).toMatchObject({ acquired: false, ownerPid: process.pid });

    if (first.acquired) first.release();
  });

  it('allows intentional distinct workload modes to run together', () => {
    const regular = acquireJobLease({ name: 'verify-shorts:default', lockRoot });
    const flagged = acquireJobLease({ name: 'verify-shorts:flagged', lockRoot });

    expect(regular.acquired).toBe(true);
    expect(flagged.acquired).toBe(true);

    if (regular.acquired) regular.release();
    if (flagged.acquired) flagged.release();
  });

  it('reclaims a lock whose recorded owner is dead', () => {
    const dir = path.join(lockRoot, 'rss-poll.lock');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ pid: 999_999, token: 'dead' }));

    const lease = acquireJobLease({ name: 'rss-poll', lockRoot });
    expect(lease.acquired).toBe(true);
    if (lease.acquired) lease.release();
  });

  it('reclaims an abandoned lock directory with no owner record', () => {
    const dir = path.join(lockRoot, 'thumbnail-watch.lock');
    fs.mkdirSync(dir, { recursive: true });
    const stale = new Date(Date.now() - 10_000);
    fs.utimesSync(dir, stale, stale);

    const lease = acquireJobLease({ name: 'thumbnail-watch', lockRoot });
    expect(lease.acquired).toBe(true);
    if (lease.acquired) lease.release();
  });

  it('does not let an old owner release a replacement lease', () => {
    const first = acquireJobLease({ name: 'feed', lockRoot });
    expect(first.acquired).toBe(true);
    if (!first.acquired) return;

    fs.rmSync(first.path, { recursive: true, force: true });
    const replacement = acquireJobLease({ name: 'feed', lockRoot });
    expect(replacement.acquired).toBe(true);

    first.release();
    expect(fs.existsSync(replacement.path)).toBe(true);
    if (replacement.acquired) replacement.release();
  });

  it('requests cooperative stop at the deadline and hard-stops only after grace', () => {
    jest.useFakeTimers();
    const hardStop = jest.fn();
    const budget = createRunBudget({ maxSeconds: 10, hardStopGraceSeconds: 5, onHardStop: hardStop });

    jest.advanceTimersByTime(9_999);
    expect(budget.signal.aborted).toBe(false);
    jest.advanceTimersByTime(1);
    expect(budget.signal.aborted).toBe(true);
    expect(hardStop).not.toHaveBeenCalled();
    jest.advanceTimersByTime(5_000);
    expect(hardStop).toHaveBeenCalledTimes(1);

    budget.finish();
  });

  it('turns SIGTERM into a cooperative stop and releases the lease on finish', () => {
    const previousExitCode = process.exitCode;
    const job = startManagedJob({ name: 'signal-test', lockRoot });
    expect(job.acquired).toBe(true);

    process.emit('SIGTERM', 'SIGTERM');
    expect(job.signal.aborted).toBe(true);
    job.finish();

    const replacement = acquireJobLease({ name: 'signal-test', lockRoot });
    expect(replacement.acquired).toBe(true);
    if (replacement.acquired) replacement.release();
    process.exitCode = previousExitCode;
  });
});
