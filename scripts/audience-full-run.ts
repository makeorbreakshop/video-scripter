/** Owner-only continuation: clean sample errors, mine remaining comments, rebuild themes. */
import { q, getPool } from '../lib/admin/db';
import { ownerChannel } from '../lib/app/audience/owner';
import { specificSignal, type ObservationType } from '../lib/app/audience/extraction-core';
import { mineComments } from '../lib/app/audience/extraction';
import { buildThemes } from '../lib/app/audience/themes';

async function main() {
  const channelId = process.argv[2];
  if (!channelId) throw new Error('channel ID required');
  await ownerChannel(channelId);
  const observations = await q<{ id: string; type: ObservationType; quote: string }>(
    `select id,type,quote from audience_observations where channel_id=$1`, [channelId]);
  const rejected = observations.filter((o) => !specificSignal(o.type, o.quote)).map((o) => o.id);
  if (rejected.length) await q(`delete from audience_observations where channel_id=$1 and id=any($2::bigint[])`, [channelId, rejected]);
  // These quote-backed sample rows express planned acquisition, not possession.
  await q(`update audience_observations set type='desire',theme_id=null
    where channel_id=$1 and id=any($2::bigint[])`, [channelId, [198, 345]]);
  console.log(JSON.stringify({ sample_rejected: rejected.length, retyped_to_desire: [198, 345] }));

  const mined = await mineComments(channelId);
  console.log(JSON.stringify({ mined }));
  const next = await q<{ version: number }>(
    `select coalesce(max(version),0)+1 version from audience_profile where channel_id=$1`, [channelId]);
  const themes = await buildThemes(channelId, next[0].version);
  console.log(JSON.stringify({ themes }));
  const counts = await q(`select (select count(*) from audience_comments where channel_id=$1) comments,
    (select count(*) from audience_comments where channel_id=$1 and mined_at is not null) mined,
    (select count(*) from audience_observations where channel_id=$1) observations,
    (select count(*) from audience_themes where channel_id=$1 and profile_version=$2) themes`, [channelId, next[0].version]);
  console.log(JSON.stringify({ counts: counts[0] }));
}

main().then(() => getPool().end()).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
  getPool().end();
});
