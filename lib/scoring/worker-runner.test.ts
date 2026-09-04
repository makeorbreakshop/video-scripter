import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScoringWorker, scoringTargetBatches } from './worker-runner';

describe('scoring worker coordination', () => {
  let lockRoot: string;

  beforeEach(() => {
    lockRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'channelsmith-scoring-test-'));
  });

  afterEach(() => {
    jest.useRealTimers();
    fs.rmSync(lockRoot, { recursive: true, force: true });
  });

  it('does no scoring work when another scorer mode owns the workload', async () => {
    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const hourlyWork = jest.fn(async () => { await firstCanFinish; });
    const backfillWork = jest.fn(async () => {});

    const hourly = runScoringWorker({ args: [], lockRoot, run: hourlyWork });
    await Promise.resolve();
    const backfill = await runScoringWorker({ args: ['--all', '--limit', '20000'], lockRoot, run: backfillWork });

    expect(backfill).toBe('skipped');
    expect(backfillWork).not.toHaveBeenCalled();
    releaseFirst();
    await expect(hourly).resolves.toBe('completed');
    expect(hourlyWork).toHaveBeenCalledTimes(1);
  });

  it('bounds every scoring database work unit to 100 targets', () => {
    const targets = Array.from({ length: 251 }, (_, id) => ({ id }));
    const batches = scoringTargetBatches(targets);

    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 51]);
    expect(batches.flat()).toEqual(targets);
  });

  it('requests a stop after 45 minutes for an hourly run with no explicit runtime budget', async () => {
    jest.useFakeTimers();
    let workSignal!: AbortSignal;
    const run = runScoringWorker({
      args: [],
      lockRoot,
      run: async (signal) => {
        workSignal = signal;
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      },
    });
    await Promise.resolve();

    jest.advanceTimersByTime(45 * 60 * 1_000 - 1);
    expect(workSignal.aborted).toBe(false);
    jest.advanceTimersByTime(1);

    await expect(run).resolves.toBe('completed');
    expect(workSignal.aborted).toBe(true);
  });
});
