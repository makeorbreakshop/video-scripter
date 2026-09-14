/** Owner-only one-time assembly after a reviewed full comment/theme run. */
import { getPool } from '../lib/admin/db';
import { buildProfile } from '../lib/app/audience/profile';

async function main() {
  const channelId = process.argv[2];
  if (!channelId) throw new Error('channel ID required');
  const profile = await buildProfile(channelId);
  console.log(JSON.stringify({ version: profile.version, built_at: profile.built_at,
    sections: profile.sections, stated: profile.stated }, null, 2));
}

main().then(() => getPool().end()).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
  getPool().end();
});
