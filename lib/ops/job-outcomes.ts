// A ledger of what each scheduled job ACHIEVED, and a detector for jobs that keep achieving
// nothing.
//
// Exit codes cannot tell "did the work" from "decided not to". launchd, the Pulse launchd
// monitor and every log-tail check we had saw exit 0 and reported green while:
//   - null-video-text stood down 12 nights running (2026-09-14..26), "Not a failure" each time,
//     with ~2 GB of text stored twice and the disk auto-expanding 18 → 27 GB;
//   - check-supabase-egress.py threw on every run from 2026-09-10 (its .log simply stopped).
//
// So a job records an outcome — progressed / idle / noop / stood_down / failed, how much it did
// and how much was left — and scripts/storage-guard.ts runs detectSilentJobs() daily over this
// ledger plus file heartbeats for jobs that do not write it. The alert fires on the Nth
// consecutive run that had work and did none, which is the shape both incidents had.
//
// Local JSONL, not a table: zero database writes, zero egress, and it lives on the one machine
// that runs every job. Bounded by trimming on append.
import fs from 'node:fs';
import path from 'node:path';

export type JobStatus = 'progressed' | 'idle' | 'noop' | 'stood_down' | 'failed';

export interface JobOutcome {
  job: string;
  /** ISO instant the run finished. */
  at: string;
  status: JobStatus;
  /** Units of work done (rows moved, cleared, deleted …). */
  progressed: number;
  /** Units of work seen but left undone, when the job can tell; null when it cannot. */
  backlog: number | null;
  detail?: string;
  /** Small structured facts a job wants to read back on its next run. */
  meta?: Record<string, unknown>;
}

/** Every LaunchAgent runs with WorkingDirectory = the repo root. (No __dirname: the scripts are ESM.) */
export const DEFAULT_LEDGER = process.env.JOB_OUTCOMES_LEDGER || path.join(process.cwd(), 'logs', 'job-outcomes.jsonl');
const DEFAULT_MAX_BYTES = 2_000_000;

/** Append one JSON line, trimming the file to its newest half-budget when it outgrows maxBytes. */
export function appendJsonLine(file: string, value: unknown, maxBytes: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(value) + '\n');
  if (fs.statSync(file).size > maxBytes) {
    const buf = fs.readFileSync(file);
    const from = buf.indexOf(0x0a, buf.length - Math.floor(maxBytes / 2)) + 1;
    fs.writeFileSync(file, buf.subarray(from));
  }
}

/** Every parseable JSON line of a file, skipping torn ones; [] when the file does not exist. */
export function readJsonLines<T>(file: string, keep: (v: any) => boolean = () => true): T[] {
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out: T[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { const v = JSON.parse(line); if (v && keep(v)) out.push(v); } catch { /* torn write */ }
  }
  return out;
}

/** Append one outcome. Never throws: a ledger problem must not fail the job that did the work. */
export function appendOutcome(o: JobOutcome, file = DEFAULT_LEDGER, { maxBytes = DEFAULT_MAX_BYTES } = {}): void {
  try {
    appendJsonLine(file, o, maxBytes);
  } catch (err) {
    console.error(`[job-outcomes] could not record ${o.job}: ${(err as Error).message}`);
  }
}

/** Convenience for scripts: stamp `at` now and append. */
export function recordOutcome(o: Omit<JobOutcome, 'at'>, file = DEFAULT_LEDGER): JobOutcome {
  const full = { ...o, at: new Date().toISOString() };
  appendOutcome(full, file);
  console.log(`[outcome] ${JSON.stringify(full)}`);
  return full;
}

/** Every parseable outcome in the ledger, oldest first. Torn lines are skipped. */
export function readOutcomes(file = DEFAULT_LEDGER): JobOutcome[] {
  return readJsonLines<JobOutcome>(file, (o) =>
    typeof o.job === 'string' && typeof o.at === 'string' && typeof o.status === 'string')
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** What a job is expected to do, and how the guard checks it did. */
export type Heartbeat =
  | {
      kind: 'ledger';
      job: string;
      /** Expected cadence. Stale after 2 × this with no record. */
      everyHours: number;
      /** Alert on this many consecutive runs with backlog and no progress (or failures). */
      maxSilentRuns: number;
    }
  | {
      kind: 'file';
      job: string;
      /** A log the job appends to on every successful run. */
      path: string;
      everyHours: number;
      /** A last line matching this is a failure even though the file is fresh. */
      failIfLastLine?: RegExp;
    };

export interface JobAlert {
  job: string;
  kind: 'stale' | 'silent-noop' | 'failing';
  message: string;
}

const hoursSince = (iso: string | number, now: Date) =>
  (now.getTime() - (typeof iso === 'number' ? iso : new Date(iso).getTime())) / 3_600_000;

function lastLine(file: string): string {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 4096);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n').filter((l) => l.trim());
    return lines.at(-1) ?? '';
  } finally {
    fs.closeSync(fd);
  }
}

export function detectSilentJobs(outcomes: readonly JobOutcome[], heartbeats: readonly Heartbeat[], now = new Date()): JobAlert[] {
  const alerts: JobAlert[] = [];
  for (const hb of heartbeats) {
    if (hb.kind === 'file') {
      let mtime: number;
      try { mtime = fs.statSync(hb.path).mtimeMs; } catch {
        alerts.push({ job: hb.job, kind: 'stale', message: `${hb.job}: ${hb.path} does not exist` });
        continue;
      }
      const age = hoursSince(mtime, now);
      if (age > hb.everyHours * 2) {
        alerts.push({ job: hb.job, kind: 'stale',
          message: `${hb.job}: ${path.basename(hb.path)} last written ${age.toFixed(0)} h ago (expected every ${hb.everyHours} h)` });
        continue;
      }
      if (hb.failIfLastLine) {
        const line = lastLine(hb.path);
        if (hb.failIfLastLine.test(line)) {
          alerts.push({ job: hb.job, kind: 'failing', message: `${hb.job}: last line reports failure: ${line.slice(0, 200)}` });
        }
      }
      continue;
    }

    const mine = outcomes.filter((o) => o.job === hb.job);
    const last = mine.at(-1);
    if (!last) {
      alerts.push({ job: hb.job, kind: 'stale', message: `${hb.job}: no outcome ever recorded` });
      continue;
    }
    const age = hoursSince(last.at, now);
    if (age > hb.everyHours * 2) {
      alerts.push({ job: hb.job, kind: 'stale',
        message: `${hb.job}: last outcome ${age.toFixed(0)} h ago (expected every ${hb.everyHours} h)` });
      continue;
    }
    const tail = mine.slice(-hb.maxSilentRuns);
    if (tail.length < hb.maxSilentRuns) continue;
    if (tail.every((o) => o.status === 'failed')) {
      alerts.push({ job: hb.job, kind: 'failing',
        message: `${hb.job}: ${tail.length} consecutive runs failed; last: ${last.detail ?? '(no detail)'}` });
      continue;
    }
    const silent = (o: JobOutcome) =>
      (o.status === 'noop' || o.status === 'stood_down') && o.progressed === 0 && (o.backlog ?? 1) > 0;
    if (tail.every(silent)) {
      alerts.push({ job: hb.job, kind: 'silent-noop',
        message: `${hb.job}: ${tail.length} consecutive runs did no work with work outstanding ` +
                 `(backlog ${(last.backlog ?? 0).toLocaleString('en-US')}); last: ${last.detail ?? last.status}` });
    }
  }
  return alerts;
}
