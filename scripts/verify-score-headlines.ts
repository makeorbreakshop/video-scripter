// Bounded real-Postgres verification; temporary tables only, always rolled back.
import dotenv from 'dotenv';import pg from 'pg';import assert from 'node:assert/strict';
import {refreshScoredChannels} from '../lib/scoring/channel-refresh';
dotenv.config({path:'.env.local',quiet:true});const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();
try {
 await c.query('begin');await c.query("set local statement_timeout='8s'");
 await c.query('create temporary table video_scores(video_id text primary key, channel_id text, baseline double precision, score double precision,confidence text) on commit drop');
 await c.query('create temporary table channel_stats(channel_id text primary key,baseline double precision,outliers integer,name text,updated_at timestamptz) on commit drop');
 await c.query('set local search_path=pg_temp');
 await c.query("insert into channel_stats values('changed',1,0,'Preserved metadata',now()),('untouched',99,7,'Untouched',now())");
 await c.query('savepoint before_scores');
 await c.query("insert into video_scores values('a','changed',100,3,'high'),('b','changed',200,1,'high')");
 await refreshScoredChannels(c,['changed','changed']);
 assert.deepEqual((await c.query("select baseline,outliers,name from channel_stats where channel_id='changed'")).rows[0],{baseline:150,outliers:1,name:'Preserved metadata'});
 assert.equal((await c.query("select outliers from channel_stats where channel_id='untouched'")).rows[0].outliers,7);
 await c.query('rollback to savepoint before_scores');
 assert.equal((await c.query('select count(*)::int n from video_scores')).rows[0].n,0);
 assert.equal((await c.query("select baseline from channel_stats where channel_id='changed'")).rows[0].baseline,1);
 console.log('PASS: scoped headline values, unchanged metadata, untouched channels, and atomic rollback');
}finally{await c.query('rollback');await c.end();}
