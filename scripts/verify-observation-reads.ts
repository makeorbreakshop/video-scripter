/** Read-only live plan regression: observation metadata is read once per requested video. */
import dotenv from 'dotenv';
import pg from 'pg';
import assert from 'node:assert/strict';
import { OBSERVATION_RECORDS_SQL } from '../lib/scoring/observations';
dotenv.config({ path: '.env.local', quiet: true });
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('begin read only');
  await client.query("set local statement_timeout = '8s'");
  const ids = (await client.query('select video_id from track_schedule order by next_check limit 100')).rows.map(r => r.video_id);
  assert(ids.length > 0, 'needs scheduled fixture videos');
  const result = (await client.query('explain (analyze, buffers, format json) ' + OBSERVATION_RECORDS_SQL, [ids])).rows[0]['QUERY PLAN'][0];
  function visited(node: any): number {
    return (node['Relation Name'] === 'videos' ? node['Actual Rows'] * node['Actual Loops'] : 0)
      + (node.Plans ?? []).reduce((n: number, child: any) => n + visited(child), 0);
  }
  const metadataVisits = visited(result.Plan);
  console.log({ requestedVideos: ids.length, metadataVisits, observationRows: result.Plan['Actual Rows'], milliseconds: result['Execution Time'] });
  assert(metadataVisits <= ids.length, 'video metadata work must be bounded by video count, not observation count');
} finally {
  await client.query('rollback');
  await client.end();
}
