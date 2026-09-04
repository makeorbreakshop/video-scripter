interface CandidateQueryOptions {
  denseVideoIds: string[];
  denseChannelIds: string[];
  urgentLimit: number;
  oldestLimit: number;
}

const COLUMNS = `s.video_id, s.channel_id, s.published_at, s.last_views, s.last_sample_at,
  s.next_check::text as next_check, s.updated_at::text as updated_at,
  case when s.entered_reason in ('thumbnail_change', 'title_change') then s.launch_until end as change_until`;

export function dueSamplingCandidatesSql(options: CandidateQueryOptions): { text: string; values: unknown[] } {
  return {
    text: `with urgent as materialized (
      select video_id from track_schedule
       where next_check <= now() and published_at <= now()
         and (
           (published_at > now() - interval '2 hours'
             and (video_id = any($1::text[]) or coalesce(channel_id = any($2::text[]), false)))
           or (published_at > now() - interval '1 hour'
             and not (video_id = any($1::text[]) or coalesce(channel_id = any($2::text[]), false)))
           or (entered_reason in ('thumbnail_change', 'title_change')
             and launch_until > now() + interval '22 hours' and launch_until <= now() + interval '24 hours')
         )
       order by next_check asc, video_id asc limit $3
    ), oldest as materialized (
      select video_id from track_schedule where next_check <= now()
       order by next_check asc, video_id asc limit $4
    ), candidate_ids as (
      select video_id from urgent union select video_id from oldest
    )
    select ${COLUMNS}, (u.video_id is not null) as reserved_burst
      from candidate_ids c join track_schedule s on s.video_id = c.video_id
      left join urgent u on u.video_id = c.video_id
     order by (u.video_id is not null) desc, s.next_check asc, s.video_id asc`,
    values: [options.denseVideoIds, options.denseChannelIds, options.urgentLimit, options.oldestLimit],
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
