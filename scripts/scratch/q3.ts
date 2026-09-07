import dotenv from 'dotenv'; dotenv.config({path:'.env.local'});
import pg from 'pg';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2});
const r=await pool.query(`select model_version, fitted_at, (params ? 'bands') as has_bands, n_videos from score_params order by fitted_at desc limit 8`);
console.table(r.rows.map((x:any)=>({v:x.model_version,at:String(x.fitted_at).slice(4,24),bands:x.has_bands,n:x.n_videos})));
await pool.end();
