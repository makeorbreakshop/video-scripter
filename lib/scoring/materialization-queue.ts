import { longformSql } from './longform';

export interface QueueClaim { video_id: string; generation: number }
export interface ScoreDirtyTarget {
  id: string;
  channel_id: string;
  published_at: string;
  generation: string | number;
}

export const OBS_DIRTY_CLAIM_SQL = `
  /* trace:observation.queue-claim */
  with candidates as materialized (
    select d.video_id, d.generation, d.requires_bootstrap, d.not_before, d.marked_at,
           c.format, c.last_change_id, c.obs, v.published_at,
           coalesce(octet_length(c.obs), 0)::bigint as cache_bytes
      from obs_cache_dirty d
      left join video_obs_cache c on c.video_id = d.video_id
      left join videos v on v.id = d.video_id
     where d.not_before <= now() and not d.requires_bootstrap
       and coalesce(octet_length(c.obs), 0) <= $2
     order by d.not_before, d.marked_at, d.video_id
     limit $1
  ), budgeted as (
    select c.*, sum(c.cache_bytes) over (
      order by c.not_before, c.marked_at, c.video_id
    ) as running_bytes
      from candidates c
  )
  select b.video_id, b.generation, b.requires_bootstrap, b.format, b.last_change_id,
         b.obs, b.published_at
    from budgeted b
    join obs_cache_dirty d on d.video_id=b.video_id and d.generation=b.generation
   where b.running_bytes <= $2
   order by b.not_before, b.marked_at, b.video_id`;

export const OBS_DIRTY_CLEAR_SQL = `
  /* trace:observation.queue-clear */
  delete from obs_cache_dirty d using jsonb_to_recordset($1::jsonb) as x(video_id text, generation bigint)
   where d.video_id = x.video_id and d.generation = x.generation`;

export const SCORE_DIRTY_CLEAR_SQL = `
  /* trace:score.queue-clear */
  delete from score_dirty d using jsonb_to_recordset($1::jsonb) as x(video_id text, generation bigint)
   where d.video_id = x.video_id and d.generation = x.generation`;

export const SCORE_DIRTY_DEFER_SQL = `
  /* trace:score.queue-defer */
  update score_dirty d set not_before = greatest(d.not_before, now() + ($2 || ' seconds')::interval),
         attempts = d.attempts + 1
    from jsonb_to_recordset($1::jsonb) as x(video_id text, generation bigint)
   where d.video_id = x.video_id and d.generation = x.generation`;

export function ensureObservationMaterializationSql(ids: readonly string[]): { text: string; values: unknown[] } {
  const unique = [...new Set(ids.filter(Boolean))];
  return {
    text: `/* trace:observation.queue-ensure */
    with requested as (select unnest($1::text[]) as video_id), state as (
      select r.video_id, coalesce(max(l.change_id), c.last_change_id, 0) as generation,
             coalesce(c.format = 2, false) as has_v2
        from requested r
        left join observation_change_log l on l.video_id=r.video_id
        left join video_obs_cache c on c.video_id=r.video_id
       group by r.video_id, c.last_change_id, c.format
    )
    insert into obs_cache_dirty(video_id,generation,requires_bootstrap,marked_at,not_before)
    select video_id,generation,not has_v2,now(),now() from state
    on conflict (video_id) do update set
      generation=greatest(obs_cache_dirty.generation,excluded.generation),
      requires_bootstrap=obs_cache_dirty.requires_bootstrap or excluded.requires_bootstrap,
      marked_at=excluded.marked_at,
      not_before=least(obs_cache_dirty.not_before,excluded.not_before)`,
    values: [unique],
  };
}

export function scoreDirtyTargetsSql(options: { limit: number; channels: string[] }): { text: string; values: unknown[] } {
  if (!(options.limit > 0) || options.limit > 100) throw new Error('score dirty page limit must be 1..100');
  const values: unknown[] = [];
  const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
  const channels = options.channels.length ? `and v.channel_id = any(${bind(options.channels)})` : '';
  const limit = bind(options.limit);
  return {
    text: `/* trace:score.queue-targets */
    select v.id, v.channel_id, v.published_at::text as published_at, d.generation::text as generation
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

export async function walkScoreDirtyTargets<T extends ScoreDirtyTarget>(options: {
  limit: number;
  signal: AbortSignal;
  fetchPage: (limit: number) => Promise<T[]>;
  onPage: (page: T[]) => Promise<void | boolean>;
}): Promise<number> {
  let selected = 0;
  let previous = '';
  while (!options.signal.aborted && selected < options.limit) {
    const page = await options.fetchPage(Math.min(100, options.limit - selected));
    if (!page.length) break;
    const signature = page.map((row) => `${row.id}:${row.generation}`).join('|');
    if (signature === previous) throw new Error('score dirty queue made no progress');
    previous = signature;
    selected += page.length;
    if (await options.onPage(page) === false) break;
  }
  return selected;
}
