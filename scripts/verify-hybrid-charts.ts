/** Read-only canary. Explicit ids only, maximum ten; never scans source history or writes R2.
 * Load credentials externally, e.g. dotenv -e .env.local -- tsx scripts/verify-hybrid-charts.ts
 * --ids id1,id2 --live-readonly. Output contains timing/count evidence, never credentials.
 */
import pg from 'pg';
import { performance } from 'node:perf_hooks';
import { readCurrentChart } from '../lib/readings/chart-current';
import { readChartBaseline } from '../lib/readings/chart-runtime';
import { createHybridChartReader } from '../lib/readings/hybrid-chart';

const args = process.argv.slice(2);
const ids = [...new Set((args[args.indexOf('--ids') + 1] ?? '').split(',').filter(Boolean))];
if (!args.includes('--ids') || !ids.length || ids.length > 10 || ids.some(id => !/^[A-Za-z0-9_-]{1,128}$/.test(id))) {
  throw new Error('Supply --ids with one to ten video ids');
}
const dsn = process.env.DATABASE_POOLER_URL || process.env.DATABASE_URL;
if (!dsn) throw new Error('DATABASE_URL is required');
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(dsn).hostname) && !args.includes('--live-readonly')) {
  throw new Error('Remote verification requires --live-readonly');
}
const pool = new pg.Pool({ connectionString: dsn, max: 1, connectionTimeoutMillis: 1000 });
let serializedResponseBytes = 0, queries = 0, baselineReads = 0;
const read = createHybridChartReader({
  baseline: async id => { baselineReads++; return readChartBaseline(id); },
  current: async id => {
    const client = await pool.connect();
    try {
      await client.query('begin read only; set local statement_timeout=750');
      const result = await readCurrentChart(id, async <T>(sql: string, params: unknown[]) => {
        const response = await client.query(sql, params);
        queries++;
        serializedResponseBytes += Buffer.byteLength(JSON.stringify(response.rows));
        return response.rows as T[];
      });
      await client.query('rollback');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally { client.release(); }
  },
});
const evidence = [];
try {
  for (const id of ids) {
    const started = performance.now();
    const cold = await read(id);
    const coldMs = performance.now() - started;
    const warmStart = performance.now();
    const warm = await read(id);
    const warmMs = performance.now() - warmStart;
    evidence.push({ id, status: cold.status, asOf: cold.asOf, coldMs: Math.round(coldMs), warmMs: +warmMs.toFixed(2),
      points: cold.file ? cold.file.snapshots.length + cold.file.samples.length + cold.file.rss.length : 0,
      cachedEqual: JSON.stringify(cold) === JSON.stringify(warm) });
  }
  console.log(JSON.stringify({ evidence, queries, serializedResponseBytes, baselineReads, r2Writes: 0,
    targetPassed: evidence.every(r => r.status === 'current' && r.coldMs < 1000 && r.warmMs < 200 && r.cachedEqual) }, null, 2));
  if (!evidence.every(r => r.status === 'current' && r.coldMs < 1000 && r.warmMs < 200 && r.cachedEqual)) process.exitCode = 1;
} finally { await pool.end(); }
