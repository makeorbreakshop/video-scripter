import dotenv from 'dotenv'; dotenv.config({path:'.env.local'});
import pg from 'pg';
const pool=new pg.Pool({connectionString:process.env.DATABASE_SESSION_URL??process.env.DATABASE_URL,max:2});
const c=await pool.connect(); await c.query('set statement_timeout = 900000');
const r=await c.query(`select
  count(*) filter (where s.confidence='insufficient' and s.n_baseline>=3)::int as starved,
  count(*) filter (where s.confidence='insufficient')::int as insufficient,
  count(*) filter (where s.baseline is null)::int as no_baseline,
  count(*)::int as rows
 from video_scores s
 where s.channel_id in (select channel_id from user_channels)`);
console.log(process.argv[2] ?? '', JSON.stringify(r.rows[0]));
c.release(); await pool.end();
