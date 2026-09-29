// Client egress by job from the meter's ledger (lib/ops/egress-meter.ts). Local file, zero DB reads.
// Usage: npx tsx scripts/egress-report.ts [--hours 1] [--since ISO] [--until ISO]
import path from 'node:path';
import { readEgress, summarizeEgress } from '../lib/ops/egress-meter';

const a = process.argv.slice(2);
const arg = (f: string) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : undefined; };
const until = arg('--until') ? new Date(arg('--until')!) : new Date();
const since = arg('--since') ? new Date(arg('--since')!) : new Date(until.getTime() - Number(arg('--hours') ?? 1) * 3_600_000);
const s = summarizeEgress(readEgress(path.join(process.cwd(), 'logs', 'job-egress.jsonl')), since, until);
const et = (d: Date) => d.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false });
console.log(`${et(since)} → ${et(until)} ET (${s.hours.toFixed(2)} h): ${(s.total / 1e6).toFixed(1)} MB, ${(s.totalPerDay / 1e9).toFixed(2)} GB/day`);
for (const j of s.jobs) {
  console.log(`  ${j.job.padEnd(26)} ${(j.bytes / 1e6).toFixed(1).padStart(9)} MB  ${(j.perDay / 1e9).toFixed(2).padStart(6)} GB/day  ${String(j.records).padStart(4)} rec`);
}
