import type pg from 'pg';
import { advanceResponse, assessResponse, type ResponseState, type FeedResponse } from './response-freshness';
import { markSeriesDirty } from '../readings/series-store';
export type RssSampleWrite = { video_id: string; at: string; views: number | null; likes: number | null };
export const INSERT_RSS_SAMPLES_SQL = `insert into rss_samples (video_id, at, views, likes)
 select video_id, at, views, likes from jsonb_to_recordset($1::jsonb)
 as x(video_id text, at timestamptz, views bigint, likes bigint) on conflict do nothing`;
/** State and samples commit together. Row locks serialize concurrent writers; fetchedAt
 * makes a pending-buffer replay idempotent even if a later flush step failed.
 */
export async function saveRssObservations(pool: pg.Pool, samples: RssSampleWrite[], responses: FeedResponse[]): Promise<number> {
  // A pre-upgrade pending buffer has no response evidence. Preserve its previous behavior.
  if (!responses.length) {
    const n = (await pool.query(INSERT_RSS_SAMPLES_SQL, [JSON.stringify(samples)])).rowCount ?? 0;
    // The series file for every video that just moved is now stale (lib/readings/series-store.ts).
    await markSeriesDirty(pool, samples.map(s => s.video_id));
    return n;
  }
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
    const metadata = new Map<string, { at: string; time_basis: string; received_at: string; archive_ref: string | null; model_eligible: boolean }>();
    const key = (id: string, at: string) => `${id}:${Date.parse(at)}`;
    for (const r of [...responses].sort((a, b) => Date.parse(a.fetchedAt) - Date.parse(b.fetchedAt))) {
      const result = advanceResponse(states.get(r.channelId) ?? null, r);
      states.set(r.channelId, result.state);
      const { responseDate } = assessResponse(null, r);
      for (const id of Object.keys(r.views)) if (!metadata.has(key(id, r.fetchedAt))) metadata.set(key(id, r.fetchedAt), {
        at: responseDate ?? r.fetchedAt, time_basis: responseDate ? 'response-date-estimate' : 'fetch-time-only',
        received_at: r.fetchedAt, archive_ref: r.archiveRef ?? null,
        model_eligible: result.accepted && responseDate !== null,
      });
    }
    const updates = [...states].map(([channel_id, state]) => ({ channel_id, state }));
    await client.query(`update rss_response_state s set state=x.state
      from jsonb_to_recordset($1::jsonb) as x(channel_id text, state jsonb)
      where s.channel_id=x.channel_id`, [JSON.stringify(updates)]);
    const kept = samples.flatMap(s => {
      const m = metadata.get(key(s.video_id, s.at));
      return m ? [{ ...s, ...m }] : [];
    });
    const result = await client.query(INSERT_TIMED_RSS_SQL, [JSON.stringify(kept)]);
    // Inside the same transaction as the readings: either both land or neither does, so the
    // queue can never miss a video whose readings committed.
    await markSeriesDirty(client, kept.map(s => s.video_id), { transactional: true });
    await client.query('commit');
    return result.rowCount ?? 0;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

/** Backfills older than an existing API anchor are chart-only. Same-time disagreements
 * remain in the raw archive; the disputed chart/model point is flagged and withheld.
 */
export const INSERT_TIMED_RSS_SQL = `
 with raw as (select * from jsonb_to_recordset($1::jsonb)
   as x(video_id text, at timestamptz, views bigint, likes bigint, time_basis text,
        received_at timestamptz, archive_ref text, model_eligible boolean)),
 incoming as (select distinct on (video_id,at) *,
   min(views) over w is distinct from max(views) over w as conflicted, bool_and(model_eligible) over w as all_eligible
   from raw window w as (partition by video_id,at)
   order by video_id,at,received_at),
 apis as (select ids.video_id, a.sampled_at from (select distinct video_id from incoming) ids
   left join lateral (select sampled_at from view_samples where video_id=ids.video_id
     order by sampled_at desc limit 1) a on true)
 insert into rss_samples (video_id,at,views,likes,time_basis,received_at,archive_ref,model_eligible,conflicted)
 select i.video_id,i.at,i.views,i.likes,i.time_basis,i.received_at,i.archive_ref,
        i.all_eligible and not i.conflicted and (a.sampled_at is null or i.at >= a.sampled_at), i.conflicted
 from incoming i left join apis a using(video_id)
 order by i.video_id,i.at
 on conflict (video_id,at) do update set
   conflicted = rss_samples.conflicted or excluded.conflicted or rss_samples.views is distinct from excluded.views,
   model_eligible = rss_samples.model_eligible and excluded.model_eligible
                    and rss_samples.views is not distinct from excluded.views
 where excluded.conflicted or rss_samples.views is distinct from excluded.views`;
