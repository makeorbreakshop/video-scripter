// Bounded PostgreSQL integration check. Only temporary tables, always rolled back.
import dotenv from 'dotenv';import pg from 'pg';import assert from 'node:assert/strict';
import {writeSampleBatch, type SampleWrite} from '../lib/nightly/sample-batch';
dotenv.config({path:'.env.local',quiet:true});
const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();
try {
 await c.query('begin');await c.query("set local statement_timeout='10s'");
 await c.query(`create temporary table view_samples(video_id text,sampled_at timestamptz,view_count integer,like_count integer,comment_count integer,primary key(video_id,sampled_at)) on commit drop`);
 await c.query(`create temporary table view_snapshots(video_id text,snapshot_date date,view_count integer,like_count integer,comment_count integer,days_since_published integer,primary key(video_id,snapshot_date)) on commit drop`);
 await c.query(`create temporary table track_schedule(video_id text primary key,phase text,next_check timestamptz,updated_at timestamptz,checks integer default 0,last_sample_at timestamptz,last_views integer) on commit drop`);
 await c.query('set local search_path=pg_temp');
 const rows:SampleWrite[]=Array.from({length:50},(_,i)=>({videoId:`v${i}`,sampledAt:new Date('2026-09-04T21:00:00Z'),views:100+i,likes:3,comments:2,daysSincePublished:1,phase:'fixed',nextCheck:new Date('2026-09-04T22:00:00Z'),priorNextCheck:'2026-09-04 20:00:00.123456+00',priorUpdatedAt:'2026-09-04 19:00:00.654321+00'}));
 await c.query(`insert into track_schedule(video_id,phase,next_check,updated_at) select 'v'||i,'launch',$1,$2 from generate_series(0,49)i`,[rows[0].priorNextCheck,rows[0].priorUpdatedAt]);
 // A concurrent packaging change supersedes the read token for one video.
 await c.query("update track_schedule set updated_at=updated_at+interval '1 microsecond' where video_id='v0'");
 const t=Date.now();assert.equal(await writeSampleBatch(c,rows),49);
 assert.equal(await writeSampleBatch(c,rows),0,'retry must not advance already updated schedules');
 const result=(await c.query(`select (select count(*)::int from view_samples) samples,(select count(*)::int from view_snapshots) snapshots,(select sum(checks)::int from track_schedule) checks,(select phase from track_schedule where video_id='v0') raced_phase`)).rows[0];
 assert.deepEqual(result,{samples:50,snapshots:50,checks:49,raced_phase:'launch'});
 assert.equal((await c.query("select view_count from view_samples where video_id='v49'")).rows[0].view_count,149);
 // Failure halfway through must roll back both observation tables with the caller transaction.
 await c.query('savepoint failed_batch');
 const invalid=rows.map(r=>({...r,sampledAt:new Date('2026-09-04T21:05:00Z'),phase:'invalid'}));
 await c.query("alter table track_schedule add constraint phase_valid check(phase in ('fixed','launch'))");
 invalid[0].priorUpdatedAt='2026-09-04 19:00:00.654322+00';
 await assert.rejects(writeSampleBatch(c,invalid));await c.query('rollback to savepoint failed_batch');
 assert.equal((await c.query('select count(*)::int n from view_samples')).rows[0].n,50);
 console.log(JSON.stringify({passed:true,...result,elapsedMs:Date.now()-t,scope:'temporary tables; rollback'}));
}finally{await c.query('rollback');await c.end();}
