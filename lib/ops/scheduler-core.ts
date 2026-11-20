// Pure scheduling rules for scripts/scheduler.ts, the one long-lived process that replaced the
// fleet of every-5-minute LaunchAgents (2026-11-20).
//
// Why: each LaunchAgent run was `npx tsx script.ts` — npm exec, the tsx CLI and the node it
// spawns, ~270 MB per run — and launchd fired them on overlapping minutes with no notion of what
// else was hitting the database. On 2026-11-20 every active backend was waiting on DataFileRead
// and the heaviest statements were dying on statement_timeout (57014) together.
//
// The rules:
//   - a job never runs twice at once, and missed slots coalesce into ONE pending run;
//   - each job belongs to a lane with a capacity (`heavy: 1` is "no two DB-heavy jobs overlap");
//   - an exclusive job (a nightly fit or export) waits for its held lanes to drain, holds new work
//     out of them while it waits, and then runs alone in them;
//   - pending work starts oldest-pending first, ties broken by config order;
//   - a job running past its own ceiling plus grace is reported by overdue() for the runner to kill.

export interface IntervalSchedule { minutes: number; offsetSeconds?: number }
export interface DailySchedule { hour: number; minute: number }

export interface JobSpec {
  name: string;
  script: string;
  args: string[];
  lane: string;
  every?: IntervalSchedule;
  /** Local wall-clock time (this Mac runs Eastern). */
  daily?: DailySchedule;
  exclusive?: boolean;
  /** Hard ceiling. The script's own --max-seconds should sit below it. */
  maxSeconds: number;
  /** Log basename under logs/ (default: the job name) — keeps storage-guard's freshness checks. */
  log?: string;
  /** Extra environment for this job only (non-secret; secrets stay in .env.local). */
  env?: Record<string, string>;
}

export interface SchedulerConfig {
  maxConcurrent: number;
  lanes: Record<string, number>;
  /** Lanes an exclusive job empties and holds. */
  exclusiveHolds: string[];
  jobs: JobSpec[];
}

interface JobState { job: JobSpec; lastSlot: string | null; running: boolean; startedAt: number | null; pendingSince: number | null }
export type SchedulerState = Map<string, JobState>;

const pad = (n: number) => String(n).padStart(2, '0');
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The slot a job is in at `now`; a change of slot is what makes a job due. */
export function slotKey(job: JobSpec, now: number): string | null {
  if (job.every) {
    const period = job.every.minutes * 60_000;
    return `i${Math.floor((now - (job.every.offsetSeconds ?? 0) * 1000) / period)}`;
  }
  if (job.daily) {
    const d = new Date(now);
    const today = new Date(d.getFullYear(), d.getMonth(), d.getDate(), job.daily.hour, job.daily.minute).getTime();
    if (now >= today) return localDay(d);
    return localDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1));
  }
  throw new Error(`job ${job.name} has neither every nor daily`);
}

/** Interval jobs are due at boot; a daily job whose time already passed today waits for tomorrow. */
export function createSchedulerState(config: SchedulerConfig, bootAt: number): SchedulerState {
  const names = new Set<string>();
  for (const job of config.jobs) {
    if (names.has(job.name)) throw new Error(`duplicate job ${job.name}`);
    names.add(job.name);
    if (!(job.lane in config.lanes)) throw new Error(`job ${job.name} uses unknown lane ${job.lane}`);
  }
  return new Map(config.jobs.map((job) => [job.name, {
    job, lastSlot: job.daily ? slotKey(job, bootAt) : null, running: false, startedAt: null, pendingSince: null,
  }]));
}

export function markStarted(state: SchedulerState, name: string, now: number): void {
  const s = state.get(name);
  if (!s) throw new Error(`unknown job ${name}`);
  s.running = true; s.startedAt = now; s.pendingSince = null;
  s.lastSlot = slotKey(s.job, now);
}

export function markFinished(state: SchedulerState, name: string, _now: number): void {
  const s = state.get(name);
  if (!s) throw new Error(`unknown job ${name}`);
  s.running = false; s.startedAt = null;
}

/** The jobs to start now. Records when each job first became pending; does not mark starts. */
export function nextStarts(config: SchedulerConfig, state: SchedulerState, now: number): JobSpec[] {
  const order = new Map(config.jobs.map((j, i) => [j.name, i]));
  const laneUse: Record<string, number> = Object.fromEntries(Object.keys(config.lanes).map((l) => [l, 0]));
  let total = 0;
  let exclusiveActive = false;
  for (const job of config.jobs) {
    const s = state.get(job.name)!;
    if (!s.running) continue;
    total++; laneUse[job.lane]++;
    if (job.exclusive) exclusiveActive = true;
  }

  const pending: JobSpec[] = [];
  for (const job of config.jobs) {
    const s = state.get(job.name)!;
    if (s.running) continue;
    const slot = slotKey(job, now);
    if (slot === null || slot === s.lastSlot) continue;
    s.pendingSince ??= now;
    pending.push(job);
  }
  pending.sort((a, b) => (state.get(a.name)!.pendingSince! - state.get(b.name)!.pendingSince!) || order.get(a.name)! - order.get(b.name)!);

  const held = new Set(config.exclusiveHolds);
  const heldInUse = () => [...held].reduce((n, l) => n + (laneUse[l] ?? 0), 0);
  const exclusiveWaiting = pending.some((j) => j.exclusive);
  const starts: JobSpec[] = [];
  for (const job of pending) {
    if (total >= config.maxConcurrent) break;
    if (job.exclusive) {
      if (exclusiveActive || heldInUse() > 0) continue;
      exclusiveActive = true;
    } else {
      if (held.has(job.lane) && (exclusiveActive || exclusiveWaiting)) continue;
      if (laneUse[job.lane] >= config.lanes[job.lane]) continue;
    }
    laneUse[job.lane]++; total++;
    starts.push(job);
  }
  return starts;
}

export function overdue(config: SchedulerConfig, state: SchedulerState, now: number, graceMs: number): string[] {
  return config.jobs
    .filter((job) => {
      const s = state.get(job.name)!;
      return s.running && s.startedAt !== null && now - s.startedAt > job.maxSeconds * 1000 + graceMs;
    })
    .map((job) => job.name);
}

/** Default node: the Homebrew symlink, never a versioned Cellar path (cleanup deletes those). */
export const NODE_BIN = '/opt/homebrew/bin/node';

/**
 * How a job is launched: ONE node process with tsx as a loader and the egress meter preloaded,
 * instead of `npx tsx` (npm exec + the tsx CLI + the node it spawns). The meter's EGRESS_JOB label
 * is the job name, the same label each LaunchAgent set, so logs/job-egress.jsonl stays continuous.
 */
export function launchSpec(job: JobSpec, root: string, baseEnv: NodeJS.ProcessEnv, nodeBin = NODE_BIN) {
  // The meter rides NODE_OPTIONS, as it did in every LaunchAgent, so a job's own children
  // (track-drain runs several scripts) are metered under the same label.
  const env: NodeJS.ProcessEnv = {
    ...baseEnv, ...job.env, EGRESS_JOB: job.name, NODE_OPTIONS: `--import ${root}/lib/ops/egress-meter.ts`,
  };
  return {
    command: nodeBin,
    args: ['--import', 'tsx', job.script, ...job.args],
    cwd: root,
    env,
    stdout: `${root}/logs/${job.log ?? job.name}-launchd.log`,
    stderr: `${root}/logs/${job.log ?? job.name}-launchd.err.log`,
  };
}
