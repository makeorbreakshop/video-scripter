// Scheduling reads the last known response clock, including unchanged counts. A recently
// fetched cached response must not satisfy a deadline for newer data.
export const CURRENT_RSS_RESPONSES_SQL = `
 select requested.video_id, s.state->'current'->'views'->>requested.video_id as views,
        s.state->'current'->>'date' as at
 from unnest($1::text[], $2::text[]) requested(video_id, channel_id)
 join rss_response_state s on s.channel_id=requested.channel_id
 where s.state->'current'->'views'->>requested.video_id is not null
 and not exists (select 1 from rss_samples r where r.video_id=requested.video_id
   and r.at=(s.state->'current'->>'date')::timestamptz and r.conflicted)`;
