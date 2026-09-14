/** Reproducible, read-only database audit of the completed owner-channel evidence. */
import { writeFile } from 'node:fs/promises';
import { q, getPool } from '../lib/admin/db';
import { ownerChannel } from '../lib/app/audience/owner';

async function main() {
  const channelId = process.argv[2];
  if (!channelId) throw new Error('channel ID required');
  await ownerChannel(channelId);
  const [counts] = await q<{ comments: string; mined: string; observations: string; invalid_quotes: string; themes: string; authors: string; videos: string; breadth_mismatches: string }>(
    `select (select count(*) from audience_comments where channel_id=$1) comments,
      (select count(*) from audience_comments where channel_id=$1 and mined_at is not null) mined,
      (select count(*) from audience_observations where channel_id=$1) observations,
      (select count(*) from audience_observations o join audience_comments c using(comment_id)
        where o.channel_id=$1 and strpos(c.text,o.quote)=0) invalid_quotes,
      (select count(*) from audience_themes where channel_id=$1 and profile_version=(
        select max(profile_version) from audience_themes where channel_id=$1)) themes,
      (select count(distinct author_hash) from audience_comments where channel_id=$1) authors,
      (select count(distinct video_id) from audience_comments where channel_id=$1) videos,
      (select count(*) from (
        select t.id from audience_themes t left join audience_observations o on o.theme_id=t.id
        left join audience_comments c on c.comment_id=o.comment_id
        where t.channel_id=$1 and t.profile_version=(select max(profile_version) from audience_themes where channel_id=$1)
        group by t.id having t.observation_count<>count(o.id) or t.video_count<>count(distinct o.video_id)
          or t.author_count<>count(distinct c.author_hash)
      ) bad) breadth_mismatches`, [channelId]);
  const themes = await q<{ id: string; type: string; label: string; observation_count: number; video_count: number; author_count: number; quote: string; video_id: string; comment_id: string }>(
    `select t.id,t.type,t.label,t.observation_count,t.video_count,t.author_count,
      o.quote,o.video_id,o.comment_id from audience_themes t
      left join audience_observations o on o.id=t.sample_observation_ids[1]
      where t.channel_id=$1 and t.profile_version=(select max(profile_version) from audience_themes where channel_id=$1)
      order by t.type,t.observation_count desc,t.id`, [channelId]);
  const lines = [
    '# Owner-channel audience evidence — full run', '',
    `Channel: ${channelId}. ${counts.mined} of ${counts.comments} stored comments mined from ${counts.videos} owned videos and ${counts.authors} distinct keyed author hashes.`,
    `${counts.observations} observations, ${counts.invalid_quotes} invalid verbatim quote spans, ${counts.themes} themes, ${counts.breadth_mismatches} theme-breadth mismatches. Extraction: claude-sonnet-5.`,
    'Theme counts describe extracted comments, not the whole audience. Video and author breadth matter more than raw observation count for profile traits.',
    '', '## Themes', '',
    ...themes.map((t) => `- **${t.type} · ${t.label}** — ${t.observation_count} observations, ${t.video_count} videos, ${t.author_count} authors. ${t.quote ? `[Example](https://www.youtube.com/watch?v=${encodeURIComponent(t.video_id)}&lc=${encodeURIComponent(t.comment_id)}): “${t.quote}”` : ''}`),
    '',
  ];
  const path = 'docs/plans/2026-09-14-audience-profile-full.md';
  await writeFile(path, lines.join('\n'));
  console.log(JSON.stringify({ path, ...counts }));
}

main().then(() => getPool().end()).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
  getPool().end();
});
