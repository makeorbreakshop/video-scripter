import type pg from 'pg';
import { advanceResponse, type ResponseState, type FeedResponse } from './response-freshness';
export type RssSampleWrite = { video_id: string; at: string; views: number | null; likes: number | null };
export const INSERT_RSS_SAMPLES_SQL = `insert into rss_samples (video_id, at, views, likes)
 select video_id, at, views, likes from jsonb_to_recordset($1::jsonb)
 as x(video_id text, at timestamptz, views bigint, likes bigint) on conflict do nothing`;
/** State and samples commit together. Row locks serialize concurrent writers; fetchedAt
 * makes a pending-buffer replay idempotent even if a later flush step failed.
 */
export async function saveRssObservations(pool: pg.Pool, samples: RssSampleWrite[], responses: FeedResponse[]): Promise<number> {
  // A pre-upgrade pending buffer has no response evidence. Preserve its previous behavior.
  if (!responses.length) return (await pool.query(INSERT_RSS_SAMPLES_SQL, [JSON.stringify(samples)])).rowCount ?? 0;
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local statement_timeout = 30000');
    const ids = [...new Set(responses.map(r => r.channelId))].sort();
    await client.query(`insert into rss_response_state (channel_id)
      select id from unnest($1::text[]) id order by id on conflict do nothing`, [ids]);
    const rows = await client.query(`select channel_id, state from rss_response_state
      where channel_id = any($1) order by channel_id for update`, [ids]);
    const states = new Map<string, ResponseState | null>(rows.rows.map(r => [r.channel_id, r.state]));
    const accepted = new Set<string>();
    const key = (id: string, at: string) => `${id}:${Date.parse(at)}`;
    for (const r of [...responses].sort((a, b) => Date.parse(a.fetchedAt) - Date.parse(b.fetchedAt))) {
      const result = advanceResponse(states.get(r.channelId) ?? null, r);
      states.set(r.channelId, result.state);
      if (result.accepted) for (const id of Object.keys(r.views)) accepted.add(key(id, r.fetchedAt));
    }
    const updates = [...states].map(([channel_id, state]) => ({ channel_id, state }));
    await client.query(`update rss_response_state s set state=x.state
      from jsonb_to_recordset($1::jsonb) as x(channel_id text, state jsonb)
      where s.channel_id=x.channel_id`, [JSON.stringify(updates)]);
    const kept = samples.filter(s => accepted.has(key(s.video_id, s.at)));
    const result = await client.query(INSERT_RSS_SAMPLES_SQL, [JSON.stringify(kept)]);
    await client.query('commit');
    return result.rowCount ?? 0;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
