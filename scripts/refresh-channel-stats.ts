// Rebuild channel_stats — the materialized headline numbers behind /app/channels and the
// channel header (lib/app/channel-stats.ts). Direct Postgres only (2026-08-31 egress rule).
//   npx tsx scripts/refresh-channel-stats.ts                     every tracked channel
//   npx tsx scripts/refresh-channel-stats.ts --channels UC1,UC2  only those
// Cheap: one set-based upsert, ~1 s for the whole tracked set.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });
import { refreshChannelStats } from '../lib/app/channel-stats';
import { getPool } from '../lib/admin/db';
import { revalidateRemote } from '../lib/app/revalidate-remote';
import { q } from '../lib/admin/db';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const channels = (arg('--channels') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const n = await refreshChannelStats(channels.length ? channels : undefined);
console.log(`${new Date().toISOString()} channel_stats: ${n} channels refreshed`);

// The numbers behind the cached channel reads just moved; ask the running app to drop the
// tags (lib/app/revalidate-remote.ts). Skipped silently without APP_BASE_URL/REVALIDATE_SECRET.
const touched = channels.length
  ? channels
  : (await q<{ channel_id: string }>(
      `select channel_id from user_channels union select channel_id from channel_tracking`
    )).map((r) => r.channel_id);
await revalidateRemote({ channels: touched });
await getPool().end();
