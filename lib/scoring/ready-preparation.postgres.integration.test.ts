import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';import pg from 'pg';
import * as queue from './materialization-queue';
test('scorer selects ready work without transferring blocked prior graphs and preserves newer work', {skip:process.env.RUN_LOCAL_PG_TESTS!=='1',timeout:60000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'score-ready-')),data=path.join(dir,'pg');
 execFileSync('initdb',['-D',data,'--no-locale','--auth-local=trust','--auth-host=reject'],{stdio:'pipe'});
 execFileSync('pg_ctl',['-D',data,'-l',path.join(dir,'pg.log'),'-o',`-k ${dir} -h '' -c shared_buffers=16MB`,'-w','start'],{stdio:'pipe'});
 const c=new pg.Client({host:dir,database:'postgres',user:os.userInfo().username});await c.connect();
 try{
 await c.query(`create table videos(id text primary key,channel_id text,published_at timestamptz,privacy_status text,is_short bool,duration text,shorts_checked_at timestamptz,view_count bigint);
 create table video_scores(video_id text primary key,scored_at timestamptz);
 create table video_obs_cache(video_id text primary key,format int,last_change_id bigint);
 create table observation_change_log(video_id text,change_id bigint);
 create table obs_cache_dirty(video_id text primary key,generation bigint,requires_bootstrap bool,marked_at timestamptz,not_before timestamptz,requested_at timestamptz);
 create table score_dirty(video_id text primary key,generation bigint,reason text,marked_at timestamptz,not_before timestamptz,attempts int default 0,claimed_at timestamptz,waiting_on text[],waiting_until timestamptz,ready_at timestamptz);
 insert into videos values('blocked','c',now()-interval '2 days','public',false,'PT10M',now(),100),('prior','c',now()-interval '4 days','public',false,'PT10M',now(),100),('ready','other',now()-interval '2 days','public',false,'PT10M',now(),100);
 insert into score_dirty(video_id,generation,marked_at,not_before) values('blocked',1,now(),now()),('ready',2,now(),now());
 insert into video_obs_cache values('ready',2,1),('blocked',2,1);`);
 assert.match(queue.scoreDirtyTargetsSql({limit:10,channels:[],prepareOnly:true}).text,/recent_keys as materialized/,'fresh priority must fence a finite indexed key window before eligibility filters');
 const q=async(sql:string,values?:any[])=> (await c.query(sql,values)).rows;
 const prepare=async()=>typeof (queue as any).prepareScoreDirtyPage==='function'
  ? (queue as any).prepareScoreDirtyPage(q,{limit:10,channels:[],maxCandidates:100})
  : {targets:await q(queue.scoreDirtyTargetsSql({limit:10,channels:[]}).text,queue.scoreDirtyTargetsSql({limit:10,channels:[]}).values)};
 let result=await prepare();assert.deepEqual(result.targets.map((r:any)=>r.id),['ready'],'blocked candidates must not enter body/prior loading');
 let parked=(await c.query("select * from score_dirty where video_id='blocked'")).rows[0];assert.deepEqual(parked.waiting_on,['prior']);assert.ok(parked.waiting_until);
 assert.equal((await c.query("select count(*)::int n from obs_cache_dirty where video_id='prior'")).rows[0].n,1);
 await c.query("delete from score_dirty where video_id='ready';insert into video_obs_cache values('prior',2,10);delete from obs_cache_dirty where video_id='prior'");
 await c.query(queue.SCORE_DEPENDENCIES_READY_SQL,[['prior']]);result=await prepare();assert.deepEqual(result.targets.map((r:any)=>r.id),['blocked']);
 assert.ok((await c.query("select claimed_at from score_dirty where video_id='blocked'")).rows[0].claimed_at);
 // A change between preflight and claim must not be claimed under its previous generation.
 await c.query("update score_dirty set claimed_at=null,generation=3");let raced=false;
 const raceQ=async(sql:string,values?:any[])=>{const rows=await q(sql,values);if(sql.includes('score.prepare')&&!raced){raced=true;await c.query('update score_dirty set generation=4');}return rows;};
 result=await (queue as any).prepareScoreDirtyPage(raceQ,{limit:10,channels:[],maxCandidates:100});assert.equal(result.targets.length,0);
 // Wake must not deadlock behind another score-row lock while holding observation locks.
 const other=new pg.Client({host:dir,database:'postgres',user:os.userInfo().username});await other.connect();
 try{await c.query("update score_dirty set waiting_on=ARRAY['prior'],waiting_until=now()+interval '15 minutes'");
 await other.query('begin');await other.query('select * from score_dirty for update');await c.query("set statement_timeout='300ms'");
 await c.query(queue.SCORE_DEPENDENCIES_READY_SQL,[['prior']]);await other.query('rollback');
 await c.query(queue.SCORE_DEPENDENCIES_READY_SQL,[['prior']]);assert.equal((await c.query('select waiting_until from score_dirty')).rows[0].waiting_until,null);
 }finally{await other.end();}
 }finally{await c.end();execFileSync('pg_ctl',['-D',data,'-m','immediate','-w','stop'],{stdio:'pipe'});}
});
