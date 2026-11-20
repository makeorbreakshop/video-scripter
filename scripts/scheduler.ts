// The one long-lived process that runs video-scripter's frequent jobs (com.mfm.video-scripter-scheduler).
// Rules live in lib/ops/scheduler-core.ts, the job table in lib/ops/scheduler-jobs.ts.
//
//   /opt/homebrew/bin/node --import tsx scripts/scheduler.ts            # run (KeepAlive LaunchAgent)
//   /opt/homebrew/bin/node --import tsx scripts/scheduler.ts --dry-run  # print the next hour's starts
//   /opt/homebrew/bin/node --import tsx scripts/scheduler.ts --only rss-poll,score   # a subset
//
// Each start appends to the job's existing logs/<job>-launchd(.err).log, and one JSON line per
// start/exit goes to stdout (logs/scheduler-launchd.log). SIGTERM stops new starts, forwards
// SIGTERM to running jobs and exits once they finish (SIGKILL after 60 s).
import fs from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  createSchedulerState, launchSpec, markFinished, markStarted, nextStarts, overdue, type SchedulerConfig,
} from '../lib/ops/scheduler-core';
import { SCHEDULER_CONFIG } from '../lib/ops/scheduler-jobs';
import { acquireJobLease } from '../lib/nightly/job-lifecycle';

const args = process.argv.slice(2);
const arg = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const only = (arg('--only') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const config: SchedulerConfig = only.length
  ? { ...SCHEDULER_CONFIG, jobs: SCHEDULER_CONFIG.jobs.filter((j) => only.includes(j.name)) }
  : SCHEDULER_CONFIG;
const root = process.cwd();
const TICK_MS = 1000;
const GRACE_MS = 60_000;
const log = (event: Record<string, unknown>) => console.log(JSON.stringify({ at: new Date().toISOString(), ...event }));

if (args.includes('--dry-run')) {
  const state = createSchedulerState(config, Date.now());
  const t0 = Date.now();
  for (let t = t0; t < t0 + 3_600_000; t += 15_000) {
    for (const job of nextStarts(config, state, t)) {
      console.log(new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/New_York' }), job.lane.padEnd(5), job.name);
      markStarted(state, job.name, t);
      markFinished(state, job.name, t); // dry run: assume instant completion
    }
  }
  process.exit(0);
}

const lease = acquireJobLease({ name: 'video-scripter-scheduler' });
if (!lease.acquired) { console.error(`scheduler already running (pid ${lease.ownerPid})`); process.exit(2); }
process.once('exit', lease.release);

fs.mkdirSync(`${root}/logs`, { recursive: true });
const state = createSchedulerState(config, Date.now());
const children = new Map<string, ChildProcess>();
let stopping = false;

function start(name: string) {
  const job = config.jobs.find((j) => j.name === name)!;
  const spec = launchSpec(job, root, process.env);
  const out = fs.openSync(spec.stdout, 'a');
  const err = fs.openSync(spec.stderr, 'a');
  const startedAt = Date.now();
  markStarted(state, name, startedAt);
  let child: ChildProcess;
  try {
    child = spawn(spec.command, spec.args, { cwd: spec.cwd, env: spec.env, stdio: ['ignore', out, err] });
  } finally { fs.closeSync(out); fs.closeSync(err); }
  children.set(name, child);
  log({ event: 'start', job: name, lane: job.lane, pid: child.pid });
  const done = (code: number | null, signal: NodeJS.Signals | null, error?: string) => {
    if (!children.has(name)) return;
    children.delete(name);
    markFinished(state, name, Date.now());
    log({ event: 'exit', job: name, code, signal, seconds: Math.round((Date.now() - startedAt) / 1000), ...(error ? { error } : {}) });
  };
  child.once('exit', (code, signal) => done(code, signal));
  child.once('error', (e) => done(null, null, e.message));
}

function tick() {
  const now = Date.now();
  for (const name of overdue(config, state, now, GRACE_MS)) {
    const child = children.get(name);
    if (!child || child.killed) continue;
    log({ event: 'overdue-kill', job: name, pid: child.pid });
    child.kill('SIGTERM');
    setTimeout(() => { if (children.get(name) === child) child.kill('SIGKILL'); }, 30_000).unref();
  }
  if (stopping) return;
  for (const job of nextStarts(config, state, now)) start(job.name);
}

function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log({ event: 'stopping', signal, running: [...children.keys()] });
  for (const child of children.values()) child.kill('SIGTERM');
  const deadline = Date.now() + 60_000;
  const wait = setInterval(() => {
    if (children.size === 0 || Date.now() > deadline) {
      for (const child of children.values()) child.kill('SIGKILL');
      clearInterval(wait);
      process.exit(0);
    }
  }, 500);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

log({ event: 'boot', pid: process.pid, jobs: config.jobs.map((j) => j.name) });
setInterval(tick, TICK_MS);
tick();
