import { gunzipSync } from 'node:zlib';
import pg from 'pg';
import { poolWithTimeout } from '../admin/db';
import { getObject, r2Config } from './archive';
import { seriesKey, type VideoSeriesFile } from './series';
import { readCurrentChart, MAX_CHART_DECODED_BYTES } from './chart-current';
import { createHybridChartReader } from './hybrid-chart';

let chartPool: pg.Pool | undefined;
function getChartPool(): pg.Pool {
  return chartPool ??= new pg.Pool({
    connectionString: process.env.DATABASE_POOLER_URL || process.env.DATABASE_URL,
    max: 1, connectionTimeoutMillis: 750, idleTimeoutMillis: 5000,
    allowExitOnIdle: true,
  });
}

/** Saved files stay in R2; routine chart reads never write them. */
export async function readChartBaseline(id: string): Promise<VideoSeriesFile | null> {
  const cfg = r2Config();
  if (!cfg) throw new Error('saved chart storage is not configured');
  const bytes = await getObject(cfg, seriesKey(id), { maxBytes: 1_000_000, timeoutMs: 1000 });
  if (!bytes) return null;
  const file = JSON.parse(gunzipSync(bytes, { maxOutputLength: MAX_CHART_DECODED_BYTES }).toString('utf8')) as VideoSeriesFile;
  if (file.v !== 1) throw new Error('unsupported saved chart version');
  return file;
}

export const readHybridChart = createHybridChartReader({
  baseline: readChartBaseline,
  current: (id) => poolWithTimeout(getChartPool(), 750, async (client) =>
    readCurrentChart(id, async <T>(sql: string, params: unknown[]) =>
      (await client.query(sql, params)).rows as T[]), 'video-scripter:chart-read'),
});
