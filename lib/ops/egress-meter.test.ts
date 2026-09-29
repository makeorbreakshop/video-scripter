import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  classifyEndpoint, EgressMeter, jobNameFor, summarizeEgress, egressBudgetAlerts, readEgress,
  type EgressRecord,
} from './egress-meter';

/** A local server that writes `bytes` to every connection and closes it. */
async function server(bytes: number): Promise<{ port: number; close: () => Promise<void> }> {
  const s = net.createServer((c) => c.end(Buffer.alloc(bytes, 120)));
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as net.AddressInfo).port;
  return { port, close: () => new Promise((r) => s.close(() => r())) };
}

function pull(port: number, open = false): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    sock.on('error', reject);
    sock.on('data', () => {});
    if (open) sock.once('data', () => resolve(sock)); else sock.on('close', () => resolve(sock));
    sock.connect(port, '127.0.0.1');
  });
}

describe('classifyEndpoint: what Supabase bills as egress', () => {
  it('counts the pooler and direct Postgres ports as postgres', () => {
    expect(classifyEndpoint('aws-0-us-east-1.pooler.supabase.com', 6543)).toBe('postgres');
    expect(classifyEndpoint('db.abc.supabase.co', 5432)).toBe('postgres');
  });
  it('counts HTTPS to a supabase.co host (PostgREST, Storage, Auth) as supabase-http', () => {
    expect(classifyEndpoint('mhzwrynnfphlxqcqytrj.supabase.co', 443)).toBe('supabase-http');
  });
  it('leaves YouTube, R2 and everything else outside the Supabase bill', () => {
    expect(classifyEndpoint('www.googleapis.com', 443)).toBe('other');
    expect(classifyEndpoint('abc.r2.cloudflarestorage.com', 443)).toBe('other');
    expect(classifyEndpoint(undefined, undefined)).toBe('other');
  });
});

describe('EgressMeter counts bytes received per socket, by endpoint class', () => {
  it('counts closed and still-open sockets, and drain() returns only the new bytes', async () => {
    const a = await server(100_000);
    const b = await server(7_000);
    const meter = new EgressMeter((_h, port) => (port === a.port ? 'postgres' : 'other'));
    const restore = meter.patch(net);
    try {
      await pull(a.port);
      await pull(a.port);
      const live = await pull(b.port, true);
      const t = meter.totals();
      expect(t.postgres).toBe(200_000);
      expect(t.other).toBe(7_000);
      expect(t.connections).toBe(3);
      live.destroy();

      expect(meter.drain().postgres).toBe(200_000);
      await pull(a.port);
      const d = meter.drain();
      expect(d.postgres).toBe(100_000);
      expect(d.other).toBe(0);
      expect(meter.drain().postgres).toBe(0);
    } finally {
      restore();
      await a.close(); await b.close();
    }
  });

  it('restores net.Socket.prototype.connect', () => {
    const before = net.Socket.prototype.connect;
    const restore = new EgressMeter().patch(net);
    expect(net.Socket.prototype.connect).not.toBe(before);
    restore();
    expect(net.Socket.prototype.connect).toBe(before);
  });
});

describe('jobNameFor', () => {
  it('prefers the LaunchAgent-given name', () => {
    expect(jobNameFor({ EGRESS_JOB: 'score' }, ['node', '/r/scripts/score-videos.ts'])).toBe('score');
  });
  it('falls back to manual:<script> from argv', () => {
    expect(jobNameFor({}, ['/usr/bin/node', '/x/node_modules/tsx/dist/cli.mjs', 'scripts/score-videos.ts', '--fit']))
      .toBe('manual:score-videos');
    expect(jobNameFor({}, ['/usr/bin/node'])).toBe('manual:node');
  });
});

const rec = (job: string, at: string, postgres: number, http = 0): EgressRecord =>
  ({ job, script: job, pid: 1, from: at, at, postgres, supabaseHttp: http, other: 0, connections: 1 });

describe('summarizeEgress / egressBudgetAlerts', () => {
  const now = new Date('2026-09-29T12:00:00Z');
  const records = [
    rec('score', '2026-09-29T11:30:00Z', 400e6),
    rec('score', '2026-09-29T11:35:00Z', 100e6, 20e6),
    rec('rss-poll', '2026-09-29T11:40:00Z', 50e6),
    rec('rss-poll', '2026-09-28T09:00:00Z', 999e9), // outside the window
  ];

  it('sums billed bytes (postgres + supabase-http) per job inside the window, largest first', () => {
    const s = summarizeEgress(records, new Date('2026-09-29T11:00:00Z'), now);
    expect(s.hours).toBe(1);
    expect(s.total).toBe(570e6);
    expect(s.jobs.map((j) => [j.job, j.bytes, j.records])).toEqual([['score', 520e6, 2], ['rss-poll', 50e6, 1]]);
    expect(s.jobs[0].perDay).toBeCloseTo(520e6 * 24);
  });

  it('alerts on the daily total and on any job over its own budget', () => {
    const s = summarizeEgress(records, new Date('2026-09-28T12:00:00Z'), now); // 24 h
    const alerts = egressBudgetAlerts(s, { totalPerDay: 0.5e9, perJobPerDay: { default: 0.3e9, 'rss-poll': 1e9 } });
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toMatch(/^client egress 0\.57 GB\/day \(budget 0\.50\); top: score 0\.52/);
    expect(alerts[1]).toMatch(/^score: client egress 0\.52 GB\/day \(budget 0\.30\)/);
  });

  it('says nothing is measured rather than reporting a clean zero', () => {
    const s = summarizeEgress([], new Date('2026-09-28T12:00:00Z'), now);
    expect(egressBudgetAlerts(s, { totalPerDay: 3e9, perJobPerDay: { default: 1e9 } }))
      .toEqual(['client egress: no meter records in the last 24 h (is NODE_OPTIONS=--import egress-meter set on the agents?)']);
  });

  it('reads the ledger, skipping torn lines', () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'egress-')), 'e.jsonl');
    fs.writeFileSync(f, JSON.stringify(records[0]) + '\n{"torn\n' + JSON.stringify({ nope: 1 }) + '\n');
    expect(readEgress(f)).toEqual([records[0]]);
  });
});
