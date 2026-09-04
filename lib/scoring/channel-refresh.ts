import { refreshChannelStatsSql } from '../app/channel-stats';

export interface StatsClient {
  query(sql: string, values?: any[]): Promise<{ rows: { channel_id: string }[] }>;
}

/** Score writes change these two headlines, not the channel's video inventory or packaging. */
export async function refreshScoredChannels(client: StatsClient, channelIds: Iterable<string>): Promise<string[]> {
  const ids = [...new Set(channelIds)].filter(Boolean).sort();
  if (!ids.length) return [];
  const result = await client.query(`update channel_stats cs
    set baseline=s.baseline, outliers=s.outliers, updated_at=now()
    from (select c.channel_id, a.baseline, a.outliers
      from (select unnest($1::text[]) as channel_id) c
      cross join lateral (
        select percentile_cont(0.5) within group (order by vs.baseline) as baseline,
          count(*) filter (where vs.score >= 2 and vs.confidence <> 'insufficient')::int as outliers
        from video_scores vs where vs.channel_id=c.channel_id
      ) a) s
    where cs.channel_id=s.channel_id returning cs.channel_id`, [ids]);
  // Preserve first-time materialization for channels not yet created by ingestion.
  const updated = new Set(result.rows.map(r => r.channel_id));
  const missing = ids.filter(id => !updated.has(id));
  if (missing.length) {
    const created = await client.query(refreshChannelStatsSql(true), [missing]);
    for (const row of created.rows) updated.add(row.channel_id);
  }
  return [...updated];
}
