/** Read-only evidence for a proposed owner-channel brief. Run with .env.local. */
import { q, getPool } from '../lib/admin/db';
import { ownerChannel } from '../lib/app/audience/owner';

async function main() {
  const channelId = process.argv[2];
  if (!channelId) throw new Error('channel ID required');
  await ownerChannel(channelId);
  const [analytics, themes, winners, columns] = await Promise.all([
    q(`select dimension,key,value,window_days,window_end from channel_audience where channel_id=$1 order by dimension,value desc`, [channelId]),
    q(`select t.id,t.type,t.label,t.description,t.observation_count,
       json_agg(json_build_object('id',o.id,'comment_id',o.comment_id,'type',o.type,'quote',o.quote,'summary',o.summary,'video_id',o.video_id)
         order by o.id) filter (where o.id is not null) observations
       from audience_themes t left join audience_observations o on o.theme_id=t.id
       where t.channel_id=$1 and t.profile_version=1
       group by t.id order by t.type,t.observation_count desc,t.id`, [channelId]),
    q(`select v.id video_id,v.title,round(sum(d.views)) views,
       round(sum(d.subscribers_gained)) subscribers_gained,
       round((1000.0*sum(d.subscribers_gained)/nullif(sum(d.views),0))::numeric,2) subs_per_1000,
       round((sum(d.average_view_percentage*d.views)/nullif(sum(d.views),0))::numeric,2) average_view_percentage
       from daily_analytics d join videos v on v.id=d.video_id
       where d.channel_id=$1 and d.date >= current_date - 90 and d.date < current_date
       group by v.id,v.title having sum(d.views)>=1000
       order by sum(d.views) desc limit 60`, [channelId]),
    q(`select column_name from information_schema.columns where table_name='videos' order by ordinal_position`),
  ]);
  console.log(JSON.stringify({analytics,themes,winners,columns},null,2));
}

main().then(() => getPool().end()).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
  getPool().end();
});
