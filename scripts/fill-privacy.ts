// Record privacy status for owner-imported videos (the OAuth import brought in unlisted/private
// uploads that must never count as channel priors). 1 unit per 50 via videos.list status.
import dotenv from 'dotenv'; dotenv.config({ path: '.env.local' });
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const KEY = process.env.YOUTUBE_API_KEY!;
const { rows } = await pool.query(`select id from videos where data_source = 'owner' and privacy_status is null limit 2000`);
let units = 0, seen = 0; const counts: Record<string, number> = {};
for (let i = 0; i < rows.length; i += 50) {
  const ids = rows.slice(i, i + 50).map((r) => r.id);
  const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=status&id=${ids.join(',')}&key=${KEY}`); units++;
  if (!res.ok) { console.error('api', res.status); break; }
  const data: any = await res.json(); const got = new Set<string>();
  for (const v of data.items || []) { const s = v.status?.privacyStatus || 'unknown'; got.add(v.id); counts[s] = (counts[s] || 0) + 1; await pool.query(`update videos set privacy_status=$2 where id=$1`, [v.id, s]); seen++; }
  for (const id of ids) if (!got.has(id)) { counts.missing = (counts.missing || 0) + 1; await pool.query(`update videos set privacy_status='missing' where id=$1`, [id]); }
}
await pool.query(`insert into quota_ledger (category, units) values ('privacy', $1)`, [units]).catch(() => {});
console.log(`privacy: ${rows.length} candidates, ${seen} found, ${units} units`, counts); await pool.end();
