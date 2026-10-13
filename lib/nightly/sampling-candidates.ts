interface CandidateQueryOptions {
  urgentLimit: number;
  oldestLimit: number;
}

const COLUMNS = `s.video_id, s.channel_id, s.published_at, s.last_views, s.last_sample_at,
  s.next_check::text as next_check, s.updated_at::text as updated_at,
  case when s.entered_reason in ('thumbnail_change', 'title_change') then s.launch_until end as change_until`;

export function dueSamplingCandidatesSql(options: CandidateQueryOptions): { text: string; values: unknown[] } {
  return {
    // Keep the 60-day packaging history in Postgres. The worker needs one tier bit per
    // candidate, not every changed video/channel downloaded and sent straight back.
    text: `with changed as materialized (
      select video_id from thumbnail_versions
       where version > 1 and first_seen > now() - interval '60 days' and video_id is not null
      union
      select video_id from title_versions
       where version > 1 and first_seen > now() - interval '60 days' and video_id is not null
    ), dense_channels as materialized (
      select distinct v.channel_id from changed c
      join lateral (select channel_id from videos where id = c.video_id limit 1) v on true
       where v.channel_id is not null
    ), urgent as materialized (
      select video_id from track_schedule
       where next_check <= now() and published_at <= now()
         and (
           (published_at > now() - interval '2 hours'
             and (video_id in (select video_id from changed) or coalesce(channel_id in (select channel_id from dense_channels), false)))
           or (published_at > now() - interval '1 hour'
             and not (video_id in (select video_id from changed) or coalesce(channel_id in (select channel_id from dense_channels), false)))
           or (entered_reason in ('thumbnail_change', 'title_change')
             and launch_until > now() + interval '22 hours' and launch_until <= now() + interval '24 hours')
         )
       order by next_check asc, video_id asc limit $1
    ), oldest as materialized (
      select video_id from track_schedule where next_check <= now()
       order by next_check asc, video_id asc limit $2
    ), candidate_ids as (
      select video_id from urgent union select video_id from oldest
    )
    select ${COLUMNS}, (u.video_id is not null) as reserved_burst,
      (s.video_id in (select video_id from changed)
        or coalesce(s.channel_id in (select channel_id from dense_channels), false)) as is_dense
      from candidate_ids c join track_schedule s on s.video_id = c.video_id
      left join urgent u on u.video_id = c.video_id
     order by (u.video_id is not null) desc, s.next_check asc, s.video_id asc`,
    values: [options.urgentLimit, options.oldestLimit],
  };
}

export function prioritizeApiCandidates<T extends { row: { video_id: string; next_check: string }; reason: string }>(
  candidates: T[], limit: number,
): T['row'][] {
  return [...candidates]
    .sort((a, b) => Number(b.reason === 'burst') - Number(a.reason === 'burst')
      || a.row.next_check.localeCompare(b.row.next_check)
      || a.row.video_id.localeCompare(b.row.video_id))
    .slice(0, limit)
    .map((candidate) => candidate.row);
}
