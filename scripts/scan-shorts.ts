// Flag Shorts via YouTube's own /shorts/<id> routing (see lib/thumbs/shorts), zero API quota.
// Prefer scripts/verify-shorts.ts (stamps shorts_checked_at, runs on a schedule); this is the quick per-channel form.
// Usage: npx tsx scripts/scan-shorts.ts [--channels UC..,UC..] [--limit 2000]
import dotenv from 'dotenv'; dotenv.config({ path: '.env.local' });
import pg from 'pg';
import { isShortByRedirect } from '../lib/thumbs/shorts';
import { longformSql } from '../lib/scoring/longform';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const a = process.argv.slice(2); const chs = a.includes('--channels') ? a[a.indexOf('--channels') + 1].split(',') : null; const lim = parseInt(a[a.indexOf('--limit') + 1] || '2000', 10);
const { rows } = await pool.query(
  `select id from videos where coalesce(is_short,false) = false ${chs ? 'and channel_id = any($1)' : "and published_at > now() - interval '30 days'"} order by published_at desc limit ${lim}`, chs ? [chs] : []);
let flagged = 0, checked = 0;
for (const r of rows) {
  const short = await isShortByRedirect(r.id); if (short === null) continue; checked++;
  await pool.query(`update videos set is_short = $2, shorts_checked_at = now() where id = $1`, [r.id, short]);
  // feed_events stores the longform flag (lib/feed/query.ts), so re-stamp this video's events.
  await pool.query(
    `update feed_events e set is_longform =
       coalesce((select ${longformSql('v')} from videos v where v.id = e.video_id), false)
     where e.video_id = $1`, [r.id]
  ).catch(() => {});
  if (short) flagged++;
}
console.log(`scan-shorts: ${checked} checked, ${flagged} flagged`); await pool.end();
