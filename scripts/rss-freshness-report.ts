// Read-only summary since each channel first entered freshness measurement.
// No API calls; no scans of rss_samples. Rates include unchanged fetched readings.
import dotenv from 'dotenv';
import pg from 'pg';
import type { ResponseState, ResponseCounters } from '../lib/rss/response-freshness';
dotenv.config({ path: '.env.local' });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();
try {
  await client.query('begin read only');
  await client.query('set local statement_timeout=15000');
  const { rows } = await client.query<{ state: ResponseState }>('select state from rss_response_state where state is not null');
  const totals: ResponseCounters = { responses: 0, unknownResponses: 0, staleResponses: 0,
    readings: 0, staleDecreases: 0, unknownDecreases: 0, rawComparisons: 0, rawDecreases: 0, acceptedComparisons: 0, acceptedDecreases: 0 };
  for (const { state } of rows) for (const k of Object.keys(totals) as (keyof ResponseCounters)[]) totals[k] += state.counters[k];
  const pct = (n: number, d: number) => d ? `${(100*n/d).toFixed(2)}%` : 'not enough comparisons';
  const et = (ms: number) => new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' ET';
  console.log(JSON.stringify({ channels: rows.length,
    earliestMeasurement: rows.length ? et(Math.min(...rows.map(r => Date.parse(r.state.since)))) : null,
    latestMeasurement: rows.length ? et(Math.max(...rows.map(r => Date.parse(r.state.latest.fetchedAt)))) : null,
    totals, staleResponseRate: pct(totals.staleResponses, totals.responses),
    unknownFreshnessRate: pct(totals.unknownResponses, totals.responses),
    shareOfRawDecreasesOnRejectedResponses: pct(totals.staleDecreases, totals.rawDecreases),
    rawDecreaseRate: pct(totals.rawDecreases, totals.rawComparisons),
    acceptedDecreaseRate: pct(totals.acceptedDecreases, totals.acceptedComparisons),
    note: 'Cumulative since each channel entered measurement. Raw compares consecutive fetched counts; accepted compares consecutive non-stale counts. Different pairs: do not subtract these rates. HTTP freshness is not count-observation time; no API validation is implied.',
  }, null, 2));
  await client.query('rollback');
} finally { client.release(); await pool.end(); }
