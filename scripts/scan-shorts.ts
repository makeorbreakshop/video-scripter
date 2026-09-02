// Flag vertical (Shorts) videos by inspecting the CDN thumbnail (pillarbox), zero API quota.
// Usage: npx tsx scripts/scan-shorts.ts [--channels UC..,UC..] [--limit 2000]
import dotenv from 'dotenv'; dotenv.config({ path: '.env.local' });
import pg from 'pg';
import { pillarboxedJpeg } from '../lib/thumbs/decode';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const a = process.argv.slice(2); const chs = a.includes('--channels') ? a[a.indexOf('--channels') + 1].split(',') : null; const lim = parseInt(a[a.indexOf('--limit') + 1] || '2000', 10);
const { rows } = await pool.query(
  `select id from videos where coalesce(is_short,false) = false ${chs ? 'and channel_id = any($1)' : "and published_at > now() - interval '30 days'"} order by published_at desc limit ${lim}`, chs ? [chs] : []);
let flagged = 0, checked = 0;
for (const r of rows) {
  try {
    const res = await fetch(`https://i.ytimg.com/vi/${r.id}/hqdefault.jpg`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) continue; checked++;
    if (await pillarboxedJpeg(Buffer.from(await res.arrayBuffer()))) { await pool.query(`update videos set is_short = true where id = $1`, [r.id]); flagged++; }
  } catch { /* skip */ }
}
console.log(`scan-shorts: ${checked} checked, ${flagged} flagged`); await pool.end();
