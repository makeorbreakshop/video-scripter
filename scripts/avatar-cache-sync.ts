// Copy each channel's YouTube avatar into R2 (avatars/{channelId}.jpg) so the UI has a fallback
// when the hotlinked original stops resolving. No YouTube API: it downloads the avatar_url we
// already hold. Idempotent — a channel is re-copied only when its avatar_url changed.
//
//   npx tsx scripts/avatar-cache-sync.ts            # everything not yet copied
//   npx tsx scripts/avatar-cache-sync.ts --limit 200 --dry
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' }); dotenv.config({ path: '.env' });

const { q, getPool } = await import('../lib/admin/db');
const { uploadAvatar } = await import('../lib/thumbs/storage');

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const limit = parseInt(arg('limit') || '5000', 10);
const dry = process.argv.includes('--dry');
const SIZE = 128;   // what the UI ever shows (56px cards, retina)

const rows = await q<{ channel_id: string; avatar_url: string }>(
  `select channel_id, avatar_url from channel_meta
    where avatar_url is not null and (avatar_cached_at is null or avatar_cached_url is distinct from avatar_url)
    order by fetched_at desc limit $1`, [limit]
);
console.log(`${rows.length} avatar${rows.length === 1 ? '' : 's'} to copy${dry ? ' (dry)' : ''}`);

const CONCURRENCY = 8;
let ok = 0, dead = 0, failed = 0;
const deadIds: string[] = [];

async function one(r: { channel_id: string; avatar_url: string }) {
  const url = /\.ggpht\.com\//.test(r.avatar_url) ? r.avatar_url.replace(/=s\d+(?=-|$)/, `=s${SIZE}`) : r.avatar_url;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    // 403/404 means YouTube rotated this URL: the browser hotlink fails too, so the row needs
    // a fresh URL from channel-meta-backfill rather than a copy of a dead image.
    if (res.status === 403 || res.status === 404) { dead++; deadIds.push(r.channel_id); return; }
    if (!res.ok) throw new Error(`${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 200) throw new Error('empty');
    if (!dry) {
      if (!(await uploadAvatar(r.channel_id, buf))) throw new Error('upload refused');
      await q(`update channel_meta set avatar_cached_at = now(), avatar_cached_url = $2 where channel_id = $1`, [r.channel_id, r.avatar_url]);
    }
    ok++;
  } catch (e: any) {
    failed++;
    if (failed <= 5) console.error(`${r.channel_id}: ${e.message}`);
  }
}

const queue = [...rows];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (let r = queue.shift(); r; r = queue.shift()) await one(r);
}));

console.log(`copied ${ok}, ${dead} dead urls (need a meta refresh), ${failed} other failures`);
if (dead) {
  // Clear the stale url so `channel-meta-backfill --blank-avatars` picks these up next.
  await q(`update channel_meta set avatar_url = null where channel_id = any($1)`, [deadIds]);
  console.log(`cleared ${dead} stale avatar_url${dead === 1 ? '' : 's'}; run: npx tsx scripts/channel-meta-backfill.ts --blank-avatars`);
}
await getPool().end();
