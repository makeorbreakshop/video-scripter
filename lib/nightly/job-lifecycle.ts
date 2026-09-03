import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

interface LeaseOwner {
  pid: number;
  token: string;
  startedAt: string;
  command: string;
}

export type JobLease =
  | { acquired: false; path: string; ownerPid: number | null }
  | { acquired: true; path: string; ownerPid: number; release: () => void };

interface AcquireJobLeaseOptions {
  name: string;
  lockRoot?: string;
  pid?: number;
  isProcessAlive?: (pid: number) => boolean;
  command?: string;
  orphanGraceMs?: number;
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.-]+/g, '-');
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readOwner(lockPath: string): LeaseOwner | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8')) as Partial<LeaseOwner>;
    if (typeof parsed.pid !== 'number' || typeof parsed.token !== 'string') return null;
    return {
      pid: parsed.pid,
      token: parsed.token,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : '',
      command: typeof parsed.command === 'string' ? parsed.command : '',
    };
  } catch {
    return null;
  }
}

export function acquireJobLease(options: AcquireJobLeaseOptions): JobLease {
  const lockRoot = options.lockRoot ?? path.join(os.tmpdir(), 'channelsmith-job-leases');
  const lockPath = path.join(lockRoot, `${safeName(options.name)}.lock`);
  const pid = options.pid ?? process.pid;
  const alive = options.isProcessAlive ?? processIsAlive;
  fs.mkdirSync(lockRoot, { recursive: true });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.mkdirSync(lockPath);
      const token = randomUUID();
      const owner: LeaseOwner = {
        pid,
        token,
        startedAt: new Date().toISOString(),
        command: options.command ?? process.argv.join(' '),
      };
      fs.writeFileSync(path.join(lockPath, 'owner.json'), `${JSON.stringify(owner)}\n`, { flag: 'wx' });

      let released = false;
      return {
        acquired: true,
        path: lockPath,
        ownerPid: pid,
        release: () => {
          if (released) return;
          released = true;
          const current = readOwner(lockPath);
          if (current?.token !== token) return;
          fs.rmSync(lockPath, { recursive: true, force: true });
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const owner = readOwner(lockPath);
      if (owner && alive(owner.pid)) {
        return { acquired: false, path: lockPath, ownerPid: owner.pid };
      }
      if (!owner) {
        // mkdir + owner.json is intentionally a two-step operation. Give a competing
        // process a short window to finish publishing its owner record, but reclaim a
        // directory left behind by a crash between those steps.
        const ageMs = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (ageMs < (options.orphanGraceMs ?? 5_000)) {
          return { acquired: false, path: lockPath, ownerPid: null };
        }
      }

      const stalePath = `${lockPath}.stale-${pid}-${randomUUID()}`;
      try {
        fs.renameSync(lockPath, stalePath);
        fs.rmSync(stalePath, { recursive: true, force: true });
      } catch (reclaimError) {
        if ((reclaimError as NodeJS.ErrnoException).code !== 'ENOENT') throw reclaimError;
      }
    }
  }

  const owner = readOwner(lockPath);
  return { acquired: false, path: lockPath, ownerPid: owner?.pid ?? null };
}

interface RunBudgetOptions {
  maxSeconds?: number;
  hardStopGraceSeconds?: number;
  onDeadline?: (reason: string) => void;
  onHardStop?: () => void;
}

export interface RunBudget {
  signal: AbortSignal;
  requestStop: (reason?: string) => void;
  finish: () => void;
}

export function createRunBudget(options: RunBudgetOptions): RunBudget {
  const controller = new AbortController();
  const graceMs = (options.hardStopGraceSeconds ?? 15) * 1_000;
  let deadlineTimer: NodeJS.Timeout | undefined;
  let hardStopTimer: NodeJS.Timeout | undefined;

  const requestStop = (reason = 'run budget exhausted') => {
    if (controller.signal.aborted) return;
    controller.abort(new Error(reason));
    options.onDeadline?.(reason);
    hardStopTimer = setTimeout(() => options.onHardStop?.(), graceMs);
    hardStopTimer.unref?.();
  };

  if (options.maxSeconds != null && options.maxSeconds > 0) {
    deadlineTimer = setTimeout(() => requestStop(), options.maxSeconds * 1_000);
    deadlineTimer.unref?.();
  }

  return {
    signal: controller.signal,
    requestStop,
    finish: () => {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      if (hardStopTimer) clearTimeout(hardStopTimer);
    },
  };
}

interface StartManagedJobOptions {
  name: string;
  args?: string[];
  lockRoot?: string;
  hardStopGraceSeconds?: number;
}

export type ManagedJob =
  | { acquired: false; signal: AbortSignal; finish: () => void }
  | { acquired: true; signal: AbortSignal; finish: () => void };

function numericArg(args: string[], name: string): number | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = Number(args[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function startManagedJob(options: StartManagedJobOptions): ManagedJob {
  const args = options.args ?? process.argv.slice(2);
  const lease = acquireJobLease({ name: options.name, lockRoot: options.lockRoot });
  if (!lease.acquired) {
    console.log(`[job:${options.name}] already running${lease.ownerPid ? ` (pid ${lease.ownerPid})` : ''}; skipping`);
    const controller = new AbortController();
    controller.abort();
    return { acquired: false, signal: controller.signal, finish: () => {} };
  }

  let intendedExitCode = 0;
  const budget = createRunBudget({
    maxSeconds: numericArg(args, '--max-seconds'),
    hardStopGraceSeconds: options.hardStopGraceSeconds,
    onDeadline: (reason) => console.log(`[job:${options.name}] ${reason}; stopping after current unit`),
    onHardStop: () => {
      console.error(`[job:${options.name}] graceful-stop window expired; forcing exit`);
      lease.release();
      process.exit(intendedExitCode);
    },
  });

  const onExit = () => lease.release();
  const onSignal = (signal: NodeJS.Signals) => {
    intendedExitCode = signal === 'SIGINT' ? 130 : signal === 'SIGHUP' ? 129 : 143;
    process.exitCode = intendedExitCode;
    budget.requestStop(`received ${signal}`);
  };
  const sigint = () => onSignal('SIGINT');
  const sigterm = () => onSignal('SIGTERM');
  const sighup = () => onSignal('SIGHUP');
  process.once('exit', onExit);
  process.once('SIGINT', sigint);
  process.once('SIGTERM', sigterm);
  process.once('SIGHUP', sighup);

  let finished = false;
  return {
    acquired: true,
    signal: budget.signal,
    finish: () => {
      if (finished) return;
      finished = true;
      budget.finish();
      process.removeListener('exit', onExit);
      process.removeListener('SIGINT', sigint);
      process.removeListener('SIGTERM', sigterm);
      process.removeListener('SIGHUP', sighup);
      lease.release();
    },
  };
}
