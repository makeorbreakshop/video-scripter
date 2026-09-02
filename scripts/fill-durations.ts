// Fill missing durations (and correct is_short) via videos.list contentDetails, 1 unit per 50.
// Usage: npx tsx scripts/fill-durations.ts [--channel UC...] [--limit 500]
import dotenv from 'dotenv'; dotenv.config({ path: '.env.local' });
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const KEY = process.env.YOUTUBE_API_KEY!;
const args = process.argv.slice(2); const ch = args[args.indexOf('--channel') + 1]; const lim = parseInt(args[args.indexOf('--limit') + 1] || '500', 10);
const SHORT = /^PT(([0-5]?[0-9])S|1M([0-2]S)?)$/;
const { rows } = await pool.query(`select id from videos where duration is null ${args.includes('--channel') ? 'and channel_id = $1' : ''} limit ${lim}`, args.includes('--channel') ? [ch] : []);
let units = 0, updated = 0;
for (let i = 0; i < rows.length; i += 50) {
  const ids = rows.slice(i, i + 50).map((r) => r.id);
  const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids.join(',')}&key=${KEY}`); units++;
  if (!res.ok) { console.error('api', res.status); break; }
  const data: any = await res.json();
  for (const v of data.items || []) {
    const d = v.contentDetails?.duration || null; if (!d) continue;
    await pool.query(`update videos set duration=$2, is_short=$3 where id=$1`, [v.id, d, SHORT.test(d)]); updated++;
  }
}
await pool.query(`insert into quota_ledger (category, units) values ('durations', $1)`, [units]).catch(() => {});
console.log(`durations: ${rows.length} candidates, ${updated} updated, ${units} units`); await pool.end();
