import { longformSql } from '../scoring/longform';

/**
 * launch-track enrollment: every long-form video published in the last 30 days gets a
 * track_schedule row. `fresh` finds the unenrolled ids from videos_published_id_idx and the
 * track_schedule key alone (index-only); the heap row, the long-form rule and the latest
 * view_samples reading are read only for those few ids. Same rows and values as the previous
 * single-pass form, which read all ~86K recent videos every 5 minutes (~400 MB, 2026-09-23).
 */
export const LAUNCH_ENROLL_SQL = `
  with fresh as materialized (
    select v.id from videos v
     where v.published_at > now() - interval '30 days'
       and not exists (select 1 from track_schedule t where t.video_id = v.id)
  )
  insert into track_schedule (video_id, channel_id, published_at, phase, next_check, launch_until, entered_reason,
                              last_sample_at, last_views)
  select v.id, v.channel_id, v.published_at,
         case when v.published_at > now() - interval '24 hours' then 'launch' else 'fixed' end,
         case when recent.sampled_at > now() - interval '5 minutes' and recent.sampled_at <= now()
              then recent.sampled_at + interval '5 minutes' else now() end,
         case when v.published_at > now() - interval '24 hours' then v.published_at + interval '24 hours' end,
         case when v.published_at > now() - interval '24 hours' then 'publish' else 'backfill' end,
         case when recent.sampled_at > now() - interval '5 minutes' and recent.sampled_at <= now()
              then recent.sampled_at end,
         case when recent.sampled_at > now() - interval '5 minutes' and recent.sampled_at <= now()
              then recent.view_count end
    from fresh f
    join videos v on v.id = f.id
    left join lateral (
      select s.sampled_at, s.view_count from view_samples s
       where s.video_id = v.id order by s.sampled_at desc limit 1
    ) recent on true
   where ${longformSql('v')}
  on conflict (video_id) do nothing`;
