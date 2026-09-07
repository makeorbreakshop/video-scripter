import dotenv from 'dotenv'; dotenv.config({ path: '.env.local' });
import pg from 'pg';
import { refreshChannelStatsSql } from '../../lib/app/channel-stats';
import { currentBaselineSql } from '../../lib/app/channel-baseline';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_SESSION_URL ?? process.env.DATABASE_URL, max: 2 });
const c = await pool.connect(); await c.query('set statement_timeout = 600000');
const t0 = Date.now();
const e = await c.query(`explain (analyze false, verbose false) ${refreshChannelStatsSql(false).replace(/\n\s*returning channel_id/, '')}`);
console.log(e.rows.map((r: any) => r['QUERY PLAN']).join('\n'));
console.log(`plan in ${Date.now() - t0}ms`);
for (const [name, id] of [['Karpathy','UCXUPKJO5MZQN11PqgIvyuvQ'],['Morley Kert','UCbtEd1MuY6gd2RpdWqkzXFw'],['Myers Woodshop','UCKeRRN0BZzWrmamVAQUME2Q'],['Steve Ramsey','UCBB7sYb14uBtk8UqSQYc9-w']] as const) {
  const r = await c.query(`select (select percentile_cont(0.5) within group (order by s.baseline) from video_scores s where s.channel_id=$1 and s.baseline is not null) as old,
                                  ${currentBaselineSql('$1')} as now`, [id]);
  const o = r.rows[0].old ? Math.round(Number(r.rows[0].old)) : null, n = r.rows[0].now ? Math.round(Number(r.rows[0].now)) : null;
  console.log(`${name.padEnd(16)} old ${String(o).padStart(10)}   now ${String(n).padStart(10)}   ${o&&n?(o/n).toFixed(3)+'x':''}`);
}
c.release(); await pool.end();
