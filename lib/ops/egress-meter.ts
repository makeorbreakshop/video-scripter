// Client-side egress meter: the bytes each job RECEIVED from Supabase, measured in the job.
//
// Supabase bills egress as data sent to clients (Supavisor/Postgres, PostgREST, Storage). Its
// usage API is behind a PAT that has expired twice, and host "transmit" includes WAL shipping
// (docs/runbooks/2026-09-26-disk-growth.md, 2026-09-28). This is a number we own instead.
//
// How: every socket a process opens goes through net.Socket.prototype.connect — pg's plain
// socket to the pooler and undici's TLS sockets for fetch alike (probed 2026-09-29: a 1,000,000-
// byte `repeat('x', …)` moved the pg socket's bytesRead by 1,000,058). The meter wraps connect,
// remembers each socket's host and port, and sums socket.bytesRead by endpoint class. That is
// wire bytes, the same thing nettop sees, including protocol and TLS overhead.
//
// Where it runs: every LaunchAgent sets NODE_OPTIONS=--import <repo>/lib/ops/egress-meter.ts and
// EGRESS_JOB=<label suffix> (scripts/install-egress-meter.ts). This file is then loaded natively by
// Node (type stripping — so: erasable TypeScript only, node: builtins only, no imports of repo
// files) before tsx or any script code. It installs itself only when EGRESS_JOB is set, so tests
// and the app never patch anything. A record is appended to logs/job-egress.jsonl every five
// minutes and at exit, one line per process per window, only when Supabase bytes moved. The
// storage guard sums the ledger per job per day against budgets (egressBudgetAlerts).
//
// Blind spots: Vercel (the app's own reads) and anything not launched by our agents.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';

export type EndpointClass = 'postgres' | 'supabase-http' | 'other';

export interface EgressTotals {
  postgres: number;
  supabaseHttp: number;
  other: number;
  connections: number;
}

export interface EgressRecord extends EgressTotals {
  job: string;
  script: string;
  pid: number;
  /** ISO start of the window this record covers. */
  from: string;
  /** ISO end of the window. */
  at: string;
}

const POSTGRES_PORTS = new Set([5432, 6543]);

export function classifyEndpoint(host: string | undefined, port: number | undefined): EndpointClass {
  if (port !== undefined && POSTGRES_PORTS.has(port)) return 'postgres';
  if (host && /(^|\.)supabase\.(co|com|in)$/.test(host)) return 'supabase-http';
  return 'other';
}

const zero = (): EgressTotals => ({ postgres: 0, supabaseHttp: 0, other: 0, connections: 0 });
const KEY: Record<EndpointClass, 'postgres' | 'supabaseHttp' | 'other'> =
  { postgres: 'postgres', 'supabase-http': 'supabaseHttp', other: 'other' };

/** Parse connect()'s overloads: (port, host), (options), (path). */
function endpointOf(args: unknown[]): { host?: string; port?: number } {
  const a = args[0];
  if (Array.isArray(a)) return endpointOf(a); // internal normalized form
  if (a && typeof a === 'object') {
    const o = a as { host?: string; port?: number | string; servername?: string };
    return { host: o.servername ?? o.host, port: o.port === undefined ? undefined : Number(o.port) };
  }
  if (typeof a === 'number' || (typeof a === 'string' && /^\d+$/.test(a))) {
    return { port: Number(a), host: typeof args[1] === 'string' ? args[1] : undefined };
  }
  return {};
}

export class EgressMeter {
  private live = new Map<net.Socket, EndpointClass>();
  private closed = zero();
  private drained = zero();
  private classify: (host: string | undefined, port: number | undefined) => EndpointClass;

  constructor(classify: (host: string | undefined, port: number | undefined) => EndpointClass = classifyEndpoint) {
    this.classify = classify;
  }

  track(socket: net.Socket, cls: EndpointClass): void {
    if (this.live.has(socket)) return;
    this.live.set(socket, cls);
    this.closed.connections++;
    socket.once('close', () => {
      this.closed[KEY[cls]] += socket.bytesRead;
      this.live.delete(socket);
    });
  }

  /** Wrap net.Socket.prototype.connect. Returns the undo. */
  patch(netModule: typeof net): () => void {
    const proto = netModule.Socket.prototype as any;
    const original = proto.connect;
    const meter = this;
    proto.connect = function (this: net.Socket, ...args: unknown[]) {
      try {
        const { host, port } = endpointOf(args);
        // A second connect() on the same socket (pg's retry) keeps the first class.
        if (!meter.live.has(this)) meter.track(this, meter.classify(host, port));
      } catch { /* the meter must never break a connection */ }
      return original.apply(this, args);
    };
    return () => { proto.connect = original; };
  }

  /** Everything received so far, closed sockets plus the bytes read on open ones. */
  totals(): EgressTotals {
    const t = { ...this.closed };
    for (const [s, cls] of this.live) t[KEY[cls]] += s.bytesRead;
    return t;
  }

  /** What was received since the previous drain(). */
  drain(): EgressTotals {
    const t = this.totals();
    const d = { postgres: t.postgres - this.drained.postgres, supabaseHttp: t.supabaseHttp - this.drained.supabaseHttp,
                other: t.other - this.drained.other, connections: t.connections - this.drained.connections };
    this.drained = t;
    return d;
  }
}

/** The job name a record is filed under: the LaunchAgent's EGRESS_JOB, else manual:<script>. */
export function jobNameFor(env: Record<string, string | undefined>, argv: readonly string[]): string {
  if (env.EGRESS_JOB) return env.EGRESS_JOB;
  const script = argv.slice(1).find((a) => /\.(ts|mts|js|mjs)$/.test(a) && !a.includes('node_modules'));
  return `manual:${script ? path.basename(script).replace(/\.(ts|mts|js|mjs)$/, '') : path.basename(argv[0] ?? 'node')}`;
}

/** Billed bytes: what Supabase counts. `other` (YouTube, R2 …) is recorded but not billed. */
export const billed = (r: EgressTotals) => r.postgres + r.supabaseHttp;

export interface EgressSummary {
  hours: number;
  total: number;
  totalPerDay: number;
  jobs: { job: string; bytes: number; perDay: number; records: number }[];
}

export function summarizeEgress(records: readonly EgressRecord[], since: Date, until = new Date()): EgressSummary {
  const hours = (until.getTime() - since.getTime()) / 3_600_000;
  const by = new Map<string, { bytes: number; records: number }>();
  for (const r of records) {
    const t = new Date(r.at).getTime();
    if (t <= since.getTime() || t > until.getTime()) continue;
    const j = by.get(r.job) ?? { bytes: 0, records: 0 };
    j.bytes += billed(r); j.records++;
    by.set(r.job, j);
  }
  const scale = hours > 0 ? 24 / hours : 0;
  const jobs = [...by].map(([job, v]) => ({ job, ...v, perDay: v.bytes * scale })).sort((a, b) => b.bytes - a.bytes);
  const total = jobs.reduce((s, j) => s + j.bytes, 0);
  return { hours, total, totalPerDay: total * scale, jobs };
}

export interface EgressBudgets {
  totalPerDay: number;
  /** Per-job daily budget in bytes; `default` applies to any job not named. */
  perJobPerDay: Record<string, number> & { default: number };
}

/**
 * The budgets the storage guard pages on. The org quota is 250 GB per cycle shared with
 * machinesformakers.com; Video Scripter's share is ≤ 3 GB/day (≤ 90 GB/cycle).
 */
export const EGRESS_BUDGETS: EgressBudgets = {
  totalPerDay: 3e9,
  perJobPerDay: { default: 0.5e9 },
};

const gb = (b: number) => (b / 1e9).toFixed(2);

export function egressBudgetAlerts(s: EgressSummary, budgets: EgressBudgets): string[] {
  if (!s.jobs.length) {
    return [`client egress: no meter records in the last ${Math.round(s.hours)} h (is NODE_OPTIONS=--import egress-meter set on the agents?)`];
  }
  const alerts: string[] = [];
  if (s.totalPerDay > budgets.totalPerDay) {
    const top = s.jobs.slice(0, 3).map((j) => `${j.job} ${gb(j.perDay)}`).join(', ');
    alerts.push(`client egress ${gb(s.totalPerDay)} GB/day (budget ${gb(budgets.totalPerDay)}); top: ${top}`);
  }
  for (const j of s.jobs) {
    const budget = budgets.perJobPerDay[j.job] ?? budgets.perJobPerDay.default;
    if (j.perDay > budget) alerts.push(`${j.job}: client egress ${gb(j.perDay)} GB/day (budget ${gb(budget)})`);
  }
  return alerts;
}

export const DEFAULT_EGRESS_LEDGER = process.env.EGRESS_LEDGER || path.join(process.cwd(), 'logs', 'job-egress.jsonl');
const LEDGER_MAX_BYTES = 16_000_000;

export function readEgress(file = DEFAULT_EGRESS_LEDGER): EgressRecord[] {
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out: EgressRecord[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line);
      if (v && typeof v.job === 'string' && typeof v.at === 'string' && typeof v.postgres === 'number') out.push(v);
    } catch { /* torn write */ }
  }
  return out;
}

function append(file: string, rec: EgressRecord): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(rec) + '\n');
    if (fs.statSync(file).size > LEDGER_MAX_BYTES) {
      const buf = fs.readFileSync(file);
      fs.writeFileSync(file, buf.subarray(buf.indexOf(0x0a, buf.length - LEDGER_MAX_BYTES / 2) + 1));
    }
  } catch { /* never fail the job over its meter */ }
}

const GLOBAL = Symbol.for('video-scripter.egress-meter');

/** The process meter when one is installed (by the preload), else null. Shared across module copies. */
export function processMeter(): EgressMeter | null {
  return ((globalThis as any)[GLOBAL]?.meter as EgressMeter | undefined) ?? null;
}

/** Install the process meter: patch net, flush every `everyMs`, and flush at exit/SIGTERM. Idempotent. */
export function installProcessMeter(opts: { job: string; ledger?: string; everyMs?: number }): EgressMeter {
  const g = globalThis as any;
  if (g[GLOBAL]) return g[GLOBAL].meter;
  const meter = new EgressMeter();
  meter.patch(net);
  const ledger = opts.ledger ?? DEFAULT_EGRESS_LEDGER;
  const script = jobNameFor({}, process.argv).replace(/^manual:/, '');
  let from = new Date();
  const flush = () => {
    const d = meter.drain();
    const at = new Date();
    if (billed(d) > 0) append(ledger, { job: opts.job, script, pid: process.pid, from: from.toISOString(), at: at.toISOString(), ...d });
    from = at;
  };
  g[GLOBAL] = { meter, flush };
  setInterval(flush, opts.everyMs ?? 300_000).unref();
  process.on('exit', flush);
  const onTerm = () => {
    flush();
    // Only we were listening: keep SIGTERM's default meaning (terminate).
    if (process.listenerCount('SIGTERM') === 0) process.exit(143);
  };
  process.once('SIGTERM', onTerm);
  return meter;
}

// Preload entry: `NODE_OPTIONS=--import …/egress-meter.ts` with EGRESS_JOB set.
if (process.env.EGRESS_JOB && process.env.EGRESS_METER !== 'off') {
  installProcessMeter({ job: process.env.EGRESS_JOB });
}
