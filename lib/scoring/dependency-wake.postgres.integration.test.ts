import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {execFileSync} from 'node:child_process';import pg from 'pg';
import * as queue from './materialization-queue';
import {materializeObservationBatch} from './observation-materializer';
import {encodeObservationState,emptyObservationState} from './observation-state';

test('blocked scores wait durably, wake only when complete, and retain recovery and fairness',{
 skip:process.env.RUN_LOCAL_PG_TESTS!=='1',timeout:60000,
},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dependency-wake-')),data=path.join(dir,'data');
 let started=false;let c:pg.Client|undefined;
 try{
  execFileSync('initdb',['-D',data,'--no-locale','--auth-local=trust','--auth-host=reject'],{stdio:'pipe'});
  execFileSync('pg_ctl',['-D',data,'-l',path.join(dir,'server.log'),'-o',`-k ${dir} -h '' -c shared_buffers=16MB`,'-w','start'],{stdio:'pipe'});started=true;
  c=new pg.Client({host:dir,database:'postgres',user:os.userInfo().username});await c.connect();
  await c.query(`set statement_timeout='10s';
   create table videos(id text primary key,channel_id text,published_at timestamptz,privacy_status text,is_short boolean,duration text,shorts_checked_at timestamptz,view_count bigint);
   create table video_scores(video_id text primary key,scored_at timestamptz);
   create table video_obs_cache(video_id text primary key,format int,last_change_id bigint,obs bytea,built_at timestamptz,n int);
   create table observation_change_log(video_id text,change_id bigint,source text,operation text,at timestamptz,views bigint,time_basis text,received_at timestamptz,model_eligible boolean,conflicted boolean);
   create table obs_cache_dirty(video_id text primary key,generation bigint,requires_bootstrap boolean,marked_at timestamptz,not_before timestamptz,requested_at timestamptz);
   create table score_dirty(video_id text primary key,generation bigint,reason text,marked_at timestamptz,not_before timestamptz,attempts int default0,claimed_at timestamptz,waiting_on text[],waiting_until timestamptz);
   insert into videos values('target','channel',now()-interval '2 days','public',false,'PT10M',now(),100);
   insert into score_dirty(video_id,generation,reason,marked_at,not_before) values('target',1,'observation',now(),now());`.replace('default0','default 0'));
  const select=async()=>{const q=queue.scoreDirtyTargetsSql({limit:1,channels:[]});return (await c!.query(q.text,q.values)).rows;};
  const state=async()=> (await c!.query("select * from score_dirty where video_id='target'")).rows[0];
  const wait=async(generation=1)=>{
   const sql=(queue as any).SCORE_DIRTY_WAIT_SQL;
   if(sql)await c!.query(sql,[JSON.stringify([{video_id:'target',generation,dependency_ids:['p','q']}])]);
   else await c!.query(queue.SCORE_DIRTY_DEFER_SQL,[JSON.stringify([{video_id:'target',generation}]),300]);
  };
  const wake=async(ids:string[])=>{if((queue as any).SCORE_DEPENDENCIES_READY_SQL)await c!.query((queue as any).SCORE_DEPENDENCIES_READY_SQL,[ids]);};
  assert.equal((await select()).length,1);await wait();
  assert.ok((await state()).waiting_until,'blocked work must persist its dependency wait, not just retry the whole batch');
  await c.query("update score_dirty set not_before=now()-interval '1 second'");
  assert.equal((await select()).length,0,'new observation advancing due time cannot bypass the dependency wait');
  await c.query("insert into video_obs_cache(video_id,format,last_change_id) values('p',2,10)");await wake(['p']);assert.ok((await state()).waiting_until,'one of two is not enough');
  await c.query("insert into video_obs_cache(video_id,format,last_change_id) values('q',1,10)");await wake(['q']);assert.ok((await state()).waiting_until,'legacy cache not enough');
  await c.query("update video_obs_cache set format=2 where video_id='q';insert into obs_cache_dirty values('q',11,false,now(),now(),null)");await wake(['q']);assert.ok((await state()).waiting_until,'stale cache not enough');
  await c.query('begin');await c.query("delete from obs_cache_dirty where video_id='q'");await wake(['q']);assert.equal((await state()).waiting_until,null);await c.query('rollback');assert.ok((await state()).waiting_until,'failed rebuild cannot wake');
  await c.query("delete from obs_cache_dirty where video_id='q'");await wake(['q']);assert.equal((await state()).waiting_until,null);assert.equal((await select()).length,1);
  await wait();assert.equal((await state()).waiting_until,null,'completion before wait cannot strand work');
  await c.query("delete from video_obs_cache where video_id='q'");await wait();
  await c.query("update score_dirty set waiting_until=now()-interval '1 second',not_before=now()-interval '1 second'");assert.equal((await select()).length,1,'recovery deadline survives restart/lost wake');
  await c.query("update score_dirty set generation=2,waiting_until=null,waiting_on=null");await wait(1);assert.equal((await state()).waiting_until,null,'old consumer cannot park newer work');
  // Exercise the actual cache builder transaction: dry-run rollback never publishes wakeup.
  await c.query("insert into videos(id,published_at) values('supply','2026-01-01')");
  await c.query("insert into video_obs_cache(video_id,format,last_change_id,obs) values('supply',2,0,$1)",[encodeObservationState(emptyObservationState('supply','2026-01-01T00:00:00Z'))]);
  await c.query("insert into obs_cache_dirty values('supply',1,false,now(),now(),now());insert into observation_change_log(video_id,change_id,source,operation,at,views,model_eligible,conflicted) values('supply',1,'rss','upsert','2026-01-02',100,true,false)");
  await c.query((queue as any).SCORE_DIRTY_WAIT_SQL,[JSON.stringify([{video_id:'target',generation:2,dependency_ids:['supply']}])]);
  const opts={maxVideos:1,maxChanges:10,maxCacheBytes:100000,maxCompressedBytes:100000};
  await materializeObservationBatch(c,{...opts,dryRun:true});assert.ok((await state()).waiting_until);
  const applied=await materializeObservationBatch(c,opts);
  assert.equal(applied.stats.completed,1);assert.equal((await state()).waiting_until,null);
  assert.equal((await c.query("select n from video_obs_cache where video_id='supply'")).rows[0].n,1);
  // Requested work gets half the slice, and old FIFO work keeps the other half.
  for(const [id,age] of [['old-a',10],['old-b',9],['urgent-a',1],['urgent-b',1]] as const){
   await c.query("insert into videos(id,published_at) values($1,now()-interval '10 days')",[id]);
   await c.query("insert into video_obs_cache(video_id,format,last_change_id) values($1,2,0)",[id]);
   await c.query("insert into obs_cache_dirty values($1,1,false,now()-($2||' hours')::interval,now()-($2||' hours')::interval,null)",[id,age]);
  }
  const request=queue.ensureObservationMaterializationSql(['urgent-a','urgent-b']);await c.query(request.text,request.values as any[]);
  const picked=(await c.query(queue.OBS_DIRTY_CLAIM_SQL,[4,100000])).rows;
  assert.deepEqual(picked.map(r=>r.video_id),['urgent-a','urgent-b','old-a','old-b']);
  await c.query("update video_obs_cache set obs=decode(repeat('ab',case when video_id like 'urgent-%' then 700 else 200 end),'hex') where video_id in('urgent-a','urgent-b','old-a','old-b')");
  for(const claimSql of [queue.OBS_DIRTY_CLAIM_SQL,queue.OBS_DIRTY_CLAIM_VERSIONED_SQL]){
    const byteBounded=(await c.query(claimSql,[4,1000])).rows;
    assert.ok(byteBounded.some(r=>r.video_id==='old-a'),'large requested blobs must not starve FIFO at the byte cap');
  }
  const after=await c.query("select requested_at,ctid::text tuple from obs_cache_dirty where video_id='urgent-a'");
  await c.query(request.text,request.values as any[]);
  assert.equal((await c.query("select ctid::text tuple from obs_cache_dirty where video_id='urgent-a'")).rows[0].tuple,after.rows[0].tuple,'repeated priority request is idempotent');
 }finally{
  await c?.end();if(started)execFileSync('pg_ctl',['-D',data,'-m','immediate','-w','stop'],{stdio:'pipe'});
 }
});
