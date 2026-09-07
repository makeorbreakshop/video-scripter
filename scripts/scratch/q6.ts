import dotenv from 'dotenv'; dotenv.config({path:'.env.local'});
import pg from 'pg';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2});
const {rows}=await pool.query(`select s.video_id, v.published_at, s.n_baseline, s.typical_neff, s.baseline, s.typical_at_age, s.age_days, s.score, s.confidence
 from video_scores s join videos v on v.id=s.video_id where s.channel_id='UCBB7sYb14uBtk8UqSQYc9-w' order by v.published_at desc limit 14`);
console.table(rows.map((r:any)=>({id:r.video_id,pub:String(r.published_at).slice(4,16),n:r.n_baseline,neff:r.typical_neff&&+r.typical_neff.toFixed(2),base:r.baseline&&Math.round(r.baseline),tAge:r.typical_at_age&&Math.round(r.typical_at_age),score:r.score&&+r.score.toFixed(2),conf:r.confidence})));
await pool.end();
