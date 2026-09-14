/** Read-only receipt for the owner-only 200-comment evidence gate. Run with .env.local. */
import { writeFile } from 'node:fs/promises';
import { q, getPool } from '../lib/admin/db';
import { isOwner } from '../lib/app/flags';

async function main() {
  const owner = (await q<{ channel_id: string; email: string; plan: string }>(
    `select yc.channel_id, u.email, u.plan from youtube_connections yc
      join app_users u on u.id = yc.user_id order by yc.connected_at limit 1`))[0];
  if (!owner || !isOwner(owner)) throw new Error('owner channel missing');
  const id = owner.channel_id;
  const [counts] = await q<{ comments: string; mined: string; observations: string; invalid_quotes: string; themes: string }>(
    `select (select count(*) from audience_comments where channel_id = $1) comments,
            (select count(*) from audience_comments where channel_id = $1 and mined_at is not null) mined,
            (select count(*) from audience_observations where channel_id = $1) observations,
            (select count(*) from audience_observations o join audience_comments c using (comment_id)
              where o.channel_id = $1 and strpos(c.text, o.quote) = 0) invalid_quotes,
            (select count(*) from audience_themes where channel_id = $1 and profile_version = 1) themes`, [id]);
  const observations = await q<{ type: string; quote: string; summary: string }>(
    `select type, quote, summary from (
       select type, quote, summary, row_number() over(partition by type order by confidence desc,id) rn
       from audience_observations where channel_id = $1
     ) x where rn <= 4 order by type,rn limit 30`, [id]);
  const themes = await q<{ type: string; label: string; description: string; observation_count: number; sample_quote: string }>(
    `select t.type,t.label,t.description,t.observation_count,
       (select quote from audience_observations o where o.id = t.sample_observation_ids[1]) sample_quote
       from audience_themes t where t.channel_id = $1 and t.profile_version = 1
       order by t.type,t.observation_count desc,t.id`, [id]);
  const lines = [
    '# Audience profile sample gate — 2026-09-14', '',
    `Owner channel: ${id}. First pull: 2,153 stored comments in 51 Data API pages (51 units).`,
    `Current: ${counts.comments} comments, ${counts.mined} sample comments mined, ${counts.observations} observations, ${counts.invalid_quotes} invalid quotes, ${counts.themes} themes.`,
    'Extraction: claude-sonnet-5; 200-comment sample, 27 calls, six model items rejected.',
    'Quality caveats: general enthusiasm is not useful specific praise; preorder intent is not tool ownership. Review before profile assembly or UI.',
    '', '## Thirty observations', '',
    ...observations.map((o, i) => `${i + 1}. **${o.type}:** ${JSON.stringify(o.quote)} → ${o.summary}`),
    '', '## Themes', '',
    ...themes.map((t) => `- **${t.type} · ${t.label} (${t.observation_count})** — ${t.description} Example: ${JSON.stringify(t.sample_quote)}`),
    '',
  ];
  await writeFile('docs/plans/2026-09-14-audience-profile-sample.md', lines.join('\n'));
  console.log(`wrote sample receipt: ${observations.length} observations, ${themes.length} themes`);
}

main().then(() => getPool().end()).catch((error) => { console.error(error.message); process.exitCode = 1; getPool().end(); });
