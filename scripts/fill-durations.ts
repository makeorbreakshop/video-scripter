// Fill missing durations (and correct is_short) via videos.list contentDetails, 1 unit per 50.
// Usage: npx tsx scripts/fill-durations.ts [--channel UC...] [--limit 500]
//
// is_short is NOT decided here. This script knows only the duration, and above 62s duration is
// not evidence (lib/ingest/classify.ts): it writes is_short only for a <= 62s Short or a > 180s
// long-form, and leaves a 63-180s clip's is_short and shorts_checked_at untouched so
// scripts/verify-shorts.ts settles it against YouTube's own routing. It never stamps
// shorts_checked_at, because it never performs the check.
import dotenv from 'dotenv'; dotenv.config({ path: '.env.local' });
import pg from 'pg';
import { isShortForFilledDuration } from '../lib/ingest/duration-fill';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const KEY = process.env.YOUTUBE_API_KEY!;
const args = process.argv.slice(2); const ch = args[args.indexOf('--channel') + 1]; const lim = parseInt(args[args.indexOf('--limit') + 1] || '500', 10);
const { rows } = await pool.query(`select id from videos where duration is null ${args.includes('--channel') ? 'and channel_id = $1' : ''} limit ${lim}`, args.includes('--channel') ? [ch] : []);
let units = 0, updated = 0;
for (let i = 0; i < rows.length; i += 50) {
  const ids = rows.slice(i, i + 50).map((r) => r.id);
  const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids.join(',')}&key=${KEY}`); units++;
  if (!res.ok) { console.error('api', res.status); break; }
  const data: any = await res.json();
  for (const v of data.items || []) {
    const d = v.contentDetails?.duration || null; if (!d) continue;
    const short = isShortForFilledDuration(d);
    if (short === null) await pool.query(`update videos set duration=$2 where id=$1`, [v.id, d]);
    else await pool.query(`update videos set duration=$2, is_short=$3 where id=$1`, [v.id, d, short]);
    updated++;
  }
}
await pool.query(`insert into quota_ledger (category, units) values ('durations', $1)`, [units]).catch(() => {});
console.log(`durations: ${rows.length} candidates, ${updated} updated, ${units} units`); await pool.end();
