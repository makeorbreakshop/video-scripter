import { longformSql } from './longform';

export interface ScoreRolloutCursor { publishedAt: string; id: string }

export function enqueueScoreRolloutSql(options: {
  version: string;
  limit: number;
  cursor: ScoreRolloutCursor | null;
  channels: string[];
}): { text: string; values: unknown[] } {
  if (!options.version.trim()) throw new Error('score rollout requires a model version');
  if (!(options.limit > 0) || options.limit > 5_000) throw new Error('score rollout limit must be 1..5000');
  const values: unknown[] = [];
  const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
  const version = bind(options.version);
  const channels = options.channels.length ? `and v.channel_id=any(${bind(options.channels)})` : '';
  const cursor = options.cursor
    ? `and (v.published_at,v.id) < (${bind(options.cursor.publishedAt)}::timestamptz,${bind(options.cursor.id)}::text)`
    : '';
  const limit = bind(options.limit);
  return {
    text: `/* trace:score.rollout-enqueue */
    with candidates as materialized (
      select v.id, v.published_at
        from videos v left join video_scores sc on sc.video_id=v.id
       where v.published_at is not null and ${longformSql('v')}
         and coalesce(v.privacy_status,'public')='public'
         and sc.model_version is distinct from ${version} ${channels} ${cursor}
       order by v.published_at desc,v.id desc limit ${limit}
    ), queued as (
      insert into score_dirty(video_id,generation,reason,marked_at,not_before)
      select id,nextval('pipeline_generation_seq'),'model-rollout',now(),now() from candidates
      on conflict (video_id) do update set generation=excluded.generation,reason=excluded.reason,
        marked_at=excluded.marked_at,not_before=least(score_dirty.not_before,excluded.not_before)
      returning video_id
    )
    select (select count(*)::int from queued) as queued,
           (select published_at::text from candidates order by published_at,id limit 1) as cursor_published_at,
           (select id from candidates order by published_at,id limit 1) as cursor_id`,
    values,
  };
}
