import { markSeriesDirty } from '../readings/series-store';

/** One already-fetched API batch; the caller owns its transaction and retry. */
export interface SampleWrite {
  videoId: string; sampledAt: Date; views: number; likes: number; comments: number;
  daysSincePublished: number; phase: string; nextCheck: Date;
  priorNextCheck: string; priorUpdatedAt: string;
}
export interface BatchClient {
  query(sql: string, values?: any[]): Promise<{ rowCount: number | null }>;
}
/** The batch as the jsonb payload every statement below reads, in stable lock order. */
export function sampleBatchPayload(rows: SampleWrite[]): string {
  return JSON.stringify([...rows].sort((a, b) => a.videoId < b.videoId ? -1 : a.videoId > b.videoId ? 1 : 0).map(r => ({
    video_id: r.videoId, sampled_at: r.sampledAt.toISOString(), snapshot_date: r.sampledAt.toISOString().slice(0, 10),
    views: r.views, likes: r.likes, comments: r.comments, days: r.daysSincePublished,
    phase: r.phase, next_check: r.nextCheck.toISOString(),
    prior_next_check: r.priorNextCheck, prior_updated_at: r.priorUpdatedAt,
  })));
}

// Shared with the local pipeline shadow (lib/nightly/api-readings-shadow.ts) so both databases
// apply the same reading rules.
export const SAMPLE_INSERT_SQL = `insert into view_samples (video_id, sampled_at, view_count, like_count, comment_count)
    select video_id, sampled_at, views, likes, comments
    from jsonb_to_recordset($1::jsonb) as x(video_id text, sampled_at timestamptz, views integer, likes integer, comments integer)
    order by video_id collate "C"
    on conflict do nothing`;
export const SNAPSHOT_UPSERT_SQL = `insert into view_snapshots (video_id, snapshot_date, view_count, like_count, comment_count, days_since_published)
    select video_id, snapshot_date, views, likes, comments, days
    from jsonb_to_recordset($1::jsonb) as x(video_id text, snapshot_date date, views integer, likes integer, comments integer, days integer)
    order by video_id collate "C"
    on conflict (video_id, snapshot_date) do update set
      view_count=excluded.view_count, like_count=excluded.like_count, comment_count=excluded.comment_count`;

export async function writeSampleBatch(client: BatchClient, rows: SampleWrite[]): Promise<number> {
  if (!rows.length) return 0;
  // Stable lock order matches the other snapshot writers. One payload, three set writes.
  const payload = sampleBatchPayload(rows);
  await client.query(SAMPLE_INSERT_SQL, [payload]);
  await client.query(SNAPSHOT_UPSERT_SQL, [payload]);
  const result = await client.query(`update track_schedule s set phase=x.phase, next_check=x.next_check,
      checks=s.checks+1, last_sample_at=x.sampled_at, last_views=x.views, updated_at=now()
    from jsonb_to_recordset($1::jsonb) as x(video_id text, phase text, next_check timestamptz,
      sampled_at timestamptz, views integer, prior_next_check timestamptz, prior_updated_at timestamptz)
    where s.video_id=x.video_id and s.next_check = x.prior_next_check and s.updated_at = x.prior_updated_at`, [payload]);
  // Every video in the batch has a new reading, so its series file is stale. Same client, so
  // the mark commits with the writes (lib/readings/series-store.ts: a queue, not a PUT).
  await markSeriesDirty(client, rows.map(r => r.videoId), { transactional: true });
  return result.rowCount ?? 0;
}
