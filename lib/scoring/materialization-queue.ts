import { PRIOR_WINDOW, PRIOR_STALE_DAYS } from './core';
import { longformSql } from './longform';

export interface QueueClaim { video_id: string; generation: number }
export interface ScoreDirtyTarget {
  id: string;
  channel_id: string;
  published_at: string;
  generation: string | number;
  ready_at?: string | null;
}

// Reserve half the video slots for requested score inputs; the rest remains oldest-first.
// Both lanes still share the existing global cache-byte budget.
const OBS_DUE_CTES = `
  priority as materialized (
    select d.video_id, d.generation, d.requires_bootstrap, d.not_before, d.marked_at
      from obs_cache_dirty d
     where d.not_before <= now() and not d.requires_bootstrap and d.requested_at is not null
     order by d.requested_at, d.video_id
     limit floor($1::numeric / 2)::int
  ), fifo as materialized (
    select d.video_id, d.generation, d.requires_bootstrap, d.not_before, d.marked_at
      from obs_cache_dirty d
     where d.not_before <= now() and not d.requires_bootstrap
       and not exists (select 1 from priority p where p.video_id=d.video_id)
     order by d.not_before, d.marked_at, d.video_id
     limit $1 - (select count(*) from priority)
  ), due as materialized (
    select p.*, 0 as lane from priority p
    union all
    select f.*, 1 as lane from fifo f
  )`;

// Keep FIFO progress at the byte cap too. Large priority blobs join FIFO while both
// lanes have work. Reserve the oldest FIFO item (or its prefix up to half the cap),
// give priority the rest, then lend unused priority bytes back to FIFO.
const OBS_BUDGET_CTES = `
  candidates as materialized (
    select d.video_id,d.generation,d.requires_bootstrap,d.not_before,d.marked_at,
           case when d.lane=0 and coalesce(octet_length(c.obs),0)>$2/2
                     and exists(select 1 from due where lane=1) then 1 else d.lane end as lane,
           c.format,c.last_change_id,v.published_at,
           coalesce(octet_length(c.obs),0)::bigint as cache_bytes
      from due d
      left join video_obs_cache c on c.video_id=d.video_id
      left join videos v on v.id=d.video_id
     where coalesce(octet_length(c.obs),0)<=$2
  ), running as materialized (
    select c.*,sum(cache_bytes) over(partition by lane order by not_before,marked_at,video_id) as running_bytes
      from candidates c
  ), reservation as (
    select greatest(
      coalesce((select cache_bytes from running where lane=1 order by not_before,marked_at,video_id limit 1),0),
      coalesce((select max(running_bytes) from running where lane=1 and running_bytes<=$2/2),0)
    ) as fifo_bytes
  ), priority_fit as materialized (
    select r.* from running r cross join reservation b where r.lane=0 and r.running_bytes<=$2-b.fifo_bytes
  ), budgeted as (
    select * from priority_fit
    union all
    select r.* from running r where r.lane=1
      and r.running_bytes <= $2-coalesce((select sum(cache_bytes) from priority_fit),0)
  )`;

export const OBS_DIRTY_CLAIM_SQL = `
  /* trace:observation.queue-claim */
  -- Limit on the queue's own due index first; join caches/videos only for that slice, and
  -- detoast obs blobs only for rows that fit the running byte budget.
  with ${OBS_DUE_CTES}, ${OBS_BUDGET_CTES}
  select b.video_id, b.generation, b.requires_bootstrap, b.format, b.last_change_id,
         oc.obs, b.published_at
    from budgeted b
    join obs_cache_dirty d on d.video_id=b.video_id and d.generation=b.generation
    left join video_obs_cache oc on oc.video_id=b.video_id
   order by b.lane, b.not_before, b.marked_at, b.video_id`;

/**
 * OBS_DIRTY_CLAIM_SQL for a materializer holding local blob copies: the same claim, ordering and
 * byte budget, but each row carries md5(obs) instead of the blob. The caller fetches only the
 * blobs it does not hold with OBS_CACHE_BLOBS_SQL, in the same transaction.
 */
export const OBS_DIRTY_CLAIM_VERSIONED_SQL = `
  /* trace:observation.queue-claim-versioned */
  -- Limit on the queue's own due index first; join caches/videos only for that slice, and
  -- detoast obs blobs only for rows that fit the running byte budget.
  with ${OBS_DUE_CTES}, ${OBS_BUDGET_CTES}
  select b.video_id, b.generation, b.requires_bootstrap, b.format, b.last_change_id,
         md5(oc.obs) as obs_md5, b.published_at
    from budgeted b
    join obs_cache_dirty d on d.video_id=b.video_id and d.generation=b.generation
    left join video_obs_cache oc on oc.video_id=b.video_id
   order by b.lane, b.not_before, b.marked_at, b.video_id`;

export const OBS_CACHE_BLOBS_SQL = `
  /* trace:observation.cache-blobs */
  select video_id, obs from video_obs_cache where video_id = any($1::text[])`;

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
         attempts = d.attempts + 1, claimed_at = null, waiting_on = null, waiting_until = null, ready_at = null
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
    insert into obs_cache_dirty(video_id,generation,requires_bootstrap,marked_at,not_before,requested_at)
    select video_id,generation,not has_v2,now(),now(),now() from state
    on conflict (video_id) do update set
      generation=greatest(obs_cache_dirty.generation,excluded.generation),
      requires_bootstrap=obs_cache_dirty.requires_bootstrap or excluded.requires_bootstrap,
      marked_at=excluded.marked_at,
      requested_at=coalesce(obs_cache_dirty.requested_at,excluded.requested_at),
      not_before=least(obs_cache_dirty.not_before,excluded.not_before)
    where obs_cache_dirty.requested_at is null
       or excluded.generation > obs_cache_dirty.generation
       or (excluded.requires_bootstrap and not obs_cache_dirty.requires_bootstrap)
       or excluded.not_before < obs_cache_dirty.not_before`,
    values: [unique],
  };
}

export function scoreDirtyTargetsSql(options: { limit: number; channels: string[]; prepareOnly?: boolean }): { text: string; values: unknown[] } {
  if (!(options.limit > 0) || options.limit > 100) throw new Error('score dirty page limit must be 1..100');
  const values: unknown[] = [];
  const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
  const channels = options.channels.length ? `and v.channel_id = any(${bind(options.channels)})` : '';
  // Keep fresh, high-reach uploads responsive without letting them starve ordinary refreshes.
  // At most one quarter of each bounded fetch is reserved for never-scored videos published in
  // the last week, half is available for completed rebuilds, and the rest drains ordinary FIFO.
  const initialLimit = bind(Math.max(1, Math.ceil(options.limit / 4)));
  const limit = bind(options.limit);
  const eligible = `${longformSql('v')} and coalesce(v.privacy_status,'public') = 'public'
       and v.published_at is not null ${channels}`;
  const cadence = `(sc.video_id is null or now() >= sc.scored_at + case
           when now() - v.published_at < interval '1 day' then interval '5 minutes'
           when now() - v.published_at < interval '7 days' then interval '1 hour'
           when now() - v.published_at < interval '30 days' then interval '1 day'
           when now() - v.published_at < interval '60 days' then interval '3 days'
           else interval '7 days' end)`;
  return {
    text: `/* trace:${options.prepareOnly ? 'score.prepare' : 'score.queue-targets'} */
    with recent_keys as materialized (
      -- Priority is a bounded newest-key window. Every other due video remains in FIFO.
      select id from videos where published_at >= now()-interval '7 days'
      order by published_at desc limit 2000
    ), initial as materialized (
      select v.id, v.channel_id, v.published_at, v.view_count, d.generation, d.not_before, d.marked_at, d.ready_at
        from recent_keys k
        join score_dirty d on d.video_id=k.id
        join videos v on v.id = d.video_id
        left join video_scores sc on sc.video_id = v.id
       where d.not_before <= now() and (d.waiting_until is null or d.waiting_until <= now()) and sc.video_id is null
         and v.published_at >= now() - interval '7 days'
         and ${eligible}
       order by v.view_count desc nulls last, v.published_at desc, d.marked_at, d.video_id
       limit ${initialLimit}
    ), resumed as materialized (
      select v.id,v.channel_id,v.published_at,v.view_count,d.generation,d.not_before,d.marked_at,d.ready_at
        from score_dirty d
        join videos v on v.id=d.video_id
        left join video_scores sc on sc.video_id=v.id
       where d.ready_at is not null and d.not_before<=now()
         and (d.waiting_until is null or d.waiting_until<=now())
         and ${eligible} and ${cadence}
         and not exists(select 1 from initial i where i.id=v.id)
       order by d.not_before,d.marked_at,d.video_id
       limit (select greatest(least(${limit}-count(*),floor(${limit}::numeric/2)::int),0) from initial)
    ), refresh as materialized (
      select v.id, v.channel_id, v.published_at, v.view_count, d.generation, d.not_before, d.marked_at, d.ready_at
        from score_dirty d
        join videos v on v.id = d.video_id
        left join video_scores sc on sc.video_id = v.id
       where d.not_before <= now() and (d.waiting_until is null or d.waiting_until <= now())
         and ${eligible}
         and not exists (select 1 from initial i where i.id = v.id)
         and not exists(select 1 from resumed r where r.id=v.id)
         and ${cadence}
       order by d.not_before, d.marked_at, d.video_id
       limit (select greatest(${limit} - count(*) - (select count(*) from resumed), 0) from initial)
    ), picked as (
      select i.*, 0 as lane from initial i
      union all
      select r.*, 1 as lane from resumed r
      union all
      select f.*, 2 as lane from refresh f
    )${options.prepareOnly ? `, refs AS MATERIALIZED (
      SELECT t.id AS target_id,p.id AS dependency_id FROM picked t
      JOIN LATERAL (
        SELECT p.id,p.published_at FROM videos p
        WHERE p.channel_id=t.channel_id AND p.published_at<t.published_at
          AND ${longformSql('p')} AND coalesce(p.privacy_status,'public')='public'
          AND coalesce(p.view_count,0)>0
        ORDER BY p.published_at DESC NULLS LAST LIMIT ${PRIOR_WINDOW}
      ) p ON extract(epoch from(t.published_at-p.published_at))/86400.0<=${PRIOR_STALE_DAYS}
    ), dependencies AS MATERIALIZED (
      SELECT id AS target_id,id AS dependency_id FROM picked UNION SELECT * FROM refs
    ), missing AS MATERIALIZED (
      SELECT dep.target_id,array_agg(dep.dependency_id ORDER BY dep.dependency_id) AS missing_ids
      FROM dependencies dep LEFT JOIN video_obs_cache c ON c.video_id=dep.dependency_id
      LEFT JOIN obs_cache_dirty d ON d.video_id=dep.dependency_id
      WHERE c.format IS DISTINCT FROM 2 OR c.last_change_id IS NULL OR c.last_change_id<d.generation
      GROUP BY dep.target_id
    )
    SELECT p.id,p.channel_id,p.published_at::text,p.generation::text,p.ready_at::text,
           coalesce(m.missing_ids,ARRAY[]::text[]) AS missing_ids
    FROM picked p LEFT JOIN missing m ON m.target_id=p.id
    ORDER BY p.lane,p.not_before,p.marked_at,p.id` : `, locked as materialized (
      -- Producers lock queue keys in video-id order. Use that same order for a batch.
      select d.video_id, d.generation
        from score_dirty d join picked p on p.id = d.video_id and p.generation = d.generation
       order by d.video_id
       for update of d
    ), claimed as (
      -- Commit this marker BEFORE loading score inputs. An enqueue that already holds the
      -- row lock finishes first; subsequent reads see its evidence. Later enqueues advance
      -- generation, so an old worker cannot acknowledge their work.
      update score_dirty d set claimed_at = clock_timestamp()
        from locked l
       where d.video_id = l.video_id and d.generation = l.generation
      returning d.video_id, d.generation
    )
    select p.id, p.channel_id, p.published_at::text as published_at, c.generation::text as generation,p.ready_at::text as ready_at
      from picked p join claimed c on c.video_id = p.id
     order by lane,
              case when lane = 0 then view_count end desc nulls last,
              case when lane = 0 then published_at end desc,
              not_before, marked_at, id
     limit ${limit}`}`,
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
    const signature = page.map((row) => `${row.id}:${row.generation}:${row.ready_at ?? ''}`).join('|');
    if (signature === previous) throw new Error('score dirty queue made no progress');
    previous = signature;
    selected += page.length;
    if (await options.onPage(page) === false) break;
  }
  return selected;
}

// Recovery deadline is independent of not_before: new observations may advance that due time.
export const SCORE_DIRTY_WAIT_SQL = `
  /* trace:score.dependency-wait */
  with requests as (
    select * from jsonb_to_recordset($1::jsonb)
      as x(video_id text, generation bigint, dependency_ids text[])
  )
  , readiness as materialized (
    select x.*,exists (
      select 1 from unnest(x.dependency_ids) as needed(video_id)
      left join video_obs_cache c using(video_id)
      left join obs_cache_dirty o using(video_id)
      where c.format is distinct from 2 or c.last_change_id is null
         or (o.video_id is not null and c.last_change_id < o.generation)
    ) as blocked from requests x
  )
  update score_dirty d set
    waiting_on=x.dependency_ids,
    waiting_until=case when x.blocked then now()+interval '15 minutes' else null end,
    ready_at=case when x.blocked then null else clock_timestamp() end,
    claimed_at=null,attempts=d.attempts+1,
    -- A completion already visible here uses the normal retry floor so the same walker
    -- cannot spin on an unchanged page. A later real wake removes this artificial delay.
    not_before=greatest(d.not_before,now()+interval '5 minutes')
  from readiness x where d.video_id=x.video_id and d.generation=x.generation`;

/** Run after cache upsert and queue-clear, inside their transaction. No change is published early. */
export const SCORE_DEPENDENCIES_READY_SQL = `
  /* trace:score.dependency-wake */
  with candidates as materialized (
    select d.video_id,d.generation from score_dirty d
     where d.waiting_until is not null and d.waiting_on && $1::text[]
     order by d.video_id limit 1000 for update of d skip locked
  )
  update score_dirty d set waiting_on=null,waiting_until=null,ready_at=clock_timestamp(),
         not_before=least(d.not_before,now())
    from candidates p
   where d.video_id=p.video_id and d.generation=p.generation
     and d.waiting_until is not null
     and not exists (
       select 1 from unnest(d.waiting_on) as needed(video_id)
       left join video_obs_cache c using(video_id)
       left join obs_cache_dirty o using(video_id)
       where c.format is distinct from 2 or c.last_change_id is null
          or (o.video_id is not null and c.last_change_id < o.generation)
     )`;


/** Cheap database-side readiness preparation; blocked graphs never cross the wire.
 * Parking and claiming still use exact generations. The scorer rechecks source watermarks
 * after claim; a race may defer a ready item but can never authorize stale input.
 */
export async function prepareScoreDirtyPage(
 q:(sql:string,values?:any[])=>Promise<any[]>,
 options:{limit:number;channels:string[];maxCandidates:number},
):Promise<{targets:ScoreDirtyTarget[];inspected:number;blocked:number}>{
 if(!Number.isInteger(options.maxCandidates)||options.maxCandidates<0||options.maxCandidates>1500)throw Error('invalid score preparation budget');
 let inspected=0,blocked=0;
 while(inspected<options.maxCandidates){
  const statement=scoreDirtyTargetsSql({limit:Math.min(options.limit,options.maxCandidates-inspected),channels:options.channels,prepareOnly:true});
  const rows=await q(statement.text,statement.values);
  if(!rows.length)break;inspected+=rows.length;
  const waiting=rows.filter(r=>r.missing_ids.length);
  blocked+=waiting.length;
  if(waiting.length){
   const ensure=ensureObservationMaterializationSql(waiting.flatMap(r=>r.missing_ids));await q(ensure.text,ensure.values);
   await q(SCORE_DIRTY_WAIT_SQL,[JSON.stringify(waiting.map(r=>({video_id:r.id,generation:r.generation,dependency_ids:r.missing_ids})))]);
  }
  const ready=rows.filter(r=>!r.missing_ids.length);
  if(ready.length){
   const claimed=await q(`/* trace:score.ready-claim */ WITH locked AS MATERIALIZED (
    SELECT d.video_id,d.generation FROM score_dirty d
    JOIN jsonb_to_recordset($1::jsonb) x(id text,generation bigint) ON x.id=d.video_id AND x.generation=d.generation
    ORDER BY d.video_id FOR UPDATE OF d SKIP LOCKED
   ) UPDATE score_dirty d SET claimed_at=clock_timestamp() FROM locked l
    WHERE d.video_id=l.video_id AND d.generation=l.generation RETURNING d.video_id,d.generation::text`,[JSON.stringify(ready)]);
   const held=new Set(claimed.map(r=>`${r.video_id}:${r.generation}`));
   return {targets:ready.filter(r=>held.has(`${r.id}:${r.generation}`)).map(({missing_ids,...target})=>target),inspected,blocked};
  }
 }
 return {targets:[],inspected,blocked};
}
