import { longformSql } from './longform';

export interface QueueClaim { video_id: string; generation: number }

export const OBS_DIRTY_CLAIM_SQL = `
  select d.video_id, d.generation, d.requires_bootstrap, c.format, c.last_change_id, c.obs,
         v.published_at
    from obs_cache_dirty d
    left join video_obs_cache c on c.video_id = d.video_id
    left join videos v on v.id = d.video_id
   where d.not_before <= now() and not d.requires_bootstrap
   order by d.not_before, d.marked_at, d.video_id
   limit $1
   for update of d skip locked`;

export const OBS_DIRTY_CLEAR_SQL = `
  delete from obs_cache_dirty d using jsonb_to_recordset($1::jsonb) as x(video_id text, generation bigint)
   where d.video_id = x.video_id and d.generation = x.generation`;

export const SCORE_DIRTY_CLEAR_SQL = `
  delete from score_dirty d using jsonb_to_recordset($1::jsonb) as x(video_id text, generation bigint)
   where d.video_id = x.video_id and d.generation = x.generation`;

export const SCORE_DIRTY_DEFER_SQL = `
  update score_dirty d set not_before = greatest(d.not_before, now() + ($2 || ' seconds')::interval),
         attempts = d.attempts + 1
    from jsonb_to_recordset($1::jsonb) as x(video_id text, generation bigint)
   where d.video_id = x.video_id and d.generation = x.generation`;

export function scoreDirtyTargetsSql(options: { limit: number; channels: string[] }): { text: string; values: unknown[] } {
  if (!(options.limit > 0) || options.limit > 100) throw new Error('score dirty page limit must be 1..100');
  const values: unknown[] = [];
  const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
  const channels = options.channels.length ? `and v.channel_id = any(${bind(options.channels)})` : '';
  const limit = bind(options.limit);
  return {
    text: `select v.id, v.channel_id, v.published_at::text as published_at, d.generation::text as generation
      from score_dirty d
      join videos v on v.id = d.video_id
      left join video_scores sc on sc.video_id = v.id
     where d.not_before <= now()
       and ${longformSql('v')} and coalesce(v.privacy_status,'public') = 'public'
       and v.published_at is not null ${channels}
       and (sc.scored_at is null or now() >= sc.scored_at +
         case
           when now() - v.published_at < interval '1 day' then interval '5 minutes'
           when now() - v.published_at < interval '7 days' then interval '1 hour'
           when now() - v.published_at < interval '30 days' then interval '1 day'
           when now() - v.published_at < interval '60 days' then interval '3 days'
           else interval '7 days'
         end)
     order by d.not_before, d.marked_at, d.video_id
     limit ${limit}`,
    values,
  };
}
