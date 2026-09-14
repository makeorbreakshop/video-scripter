alter table audience_themes add column if not exists video_count integer not null default 0;
alter table audience_themes add column if not exists author_count integer not null default 0;

-- Existing sample rows are refreshed after the full extraction. Keep their breadth accurate until then.
update audience_themes t set
  video_count = breadth.video_count,
  author_count = breadth.author_count
from (
  select o.theme_id, count(distinct o.video_id)::integer video_count,
         count(distinct c.author_hash)::integer author_count
  from audience_observations o join audience_comments c using (comment_id)
  where o.theme_id is not null group by o.theme_id
) breadth
where t.id = breadth.theme_id;
