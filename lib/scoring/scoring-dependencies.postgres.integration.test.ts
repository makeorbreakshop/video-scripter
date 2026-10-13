// Native fixture, no credentials. RUN_LOCAL_PG_TESTS=1 node --import tsx --test <this file>
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {execFileSync} from 'node:child_process';import pg from 'pg';
import {loadScoringDependencies,loadCachedRecords,partitionTargetsByCacheDependencies,SCORING_CACHE_READY_SQL} from './prior-load';
import {ensureObservationMaterializationSql} from './materialization-queue';
import {emptyObservationState,encodeObservationState} from './observation-state';

test('native watermarks, dependency parity, concurrent dirtying, and repair coalescing',{
 skip:process.env.RUN_LOCAL_PG_TESTS!=='1',timeout:60000,
},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'score-dependencies-')),data=path.join(dir,'data');
 let started=false;let c:pg.Client|undefined;
 try{
  execFileSync('initdb',['-D',data,'--no-locale','--auth-local=trust','--auth-host=reject'],{stdio:'pipe'});
  execFileSync('pg_ctl',['-D',data,'-l',path.join(dir,'server.log'),'-o',`-k ${dir} -h '' -c shared_buffers=16MB`,'-w','start'],{stdio:'pipe'});started=true;
  c=new pg.Client({host:dir,database:'postgres',user:os.userInfo().username});await c.connect();
  await c.query(`set statement_timeout='10s';
    create table video_obs_cache(video_id text primary key, format int, last_change_id bigint, obs bytea);
    create table obs_cache_dirty(video_id text primary key,generation bigint,requires_bootstrap boolean,marked_at timestamptz,not_before timestamptz);
    create table observation_change_log(video_id text,change_id bigint);
    create table video_day30_truth(video_id text,views bigint);`);
  const targets=[{id:'a'},{id:'b'},{id:'c'},{id:'d'}];
  const refs=new Map([['a',[{id:'p',pub:0,ageDays:1}]],['b',[{id:'q',pub:0,ageDays:1}]]]);
  for(const id of ['a','b','c','d','p','q'])await c.query('insert into video_obs_cache values($1,2,10,$2)',[id,encodeObservationState({...emptyObservationState(id,'2026-01-01T00:00:00Z'),lastChangeId:10,points:[{source:'rss',at:'2026-01-02T00:00:00Z',views:100,modelEligible:true,conflicted:false}]})]);
  await c.query("insert into obs_cache_dirty values('q',11,false,now(),now()); update video_obs_cache set format=1 where video_id='c'; delete from video_obs_cache where video_id='d'");
  const q=async(sql:string,args?:any[])=>(await c!.query(sql,args)).rows;
  const old=await loadCachedRecords(q,['a','b','c','d','p','q'],{requireFormat2:true});
  const oldPartition=partitionTargetsByCacheDependencies(targets,refs,old.records,old.records);
  const next=await loadScoringDependencies(q,targets,refs);
  assert.deepEqual(next.ready,oldPartition.ready);assert.deepEqual(next.blocked,oldPartition.blocked);assert.deepEqual(next.missingIds,oldPartition.missingIds);
  for(const id of ['a','p'])assert.deepEqual(next.records.get(id),old.records.get(id));
  assert.equal(next.skippedBodyIds,4);
  // Freshness changes after the lightweight probe; the ordinary body query rejects it.
  let raced=false;const concurrent=async(sql:string,args?:any[])=>{
   const rows=await q(sql,args);
   if(sql===SCORING_CACHE_READY_SQL&&!raced){raced=true;await c!.query("insert into obs_cache_dirty values('p',11,false,now(),now())");}
   return rows;
  };
  assert.deepEqual((await loadScoringDependencies(concurrent,[{id:'a'}],refs)).missingIds,['p']);
  // Repeated repair requests preserve one pending row, while new evidence and urgency win.
  const request=ensureObservationMaterializationSql(['q','q']);
  const tuple=async()=> (await c!.query("select ctid::text tuple,* from obs_cache_dirty where video_id='q'")).rows[0];
  const before=await tuple();for(let i=0;i<10;i++)await c.query(request.text,request.values as any[]);
  assert.equal((await tuple()).tuple,before.tuple);
  await c.query("insert into observation_change_log values('q',12)");await c.query(request.text,request.values as any[]);assert.equal((await tuple()).generation,'12');
  await c.query("update obs_cache_dirty set not_before=now()+interval '1 hour' where video_id='q'");await c.query(request.text,request.values as any[]);assert.ok((await tuple()).not_before.getTime()<=Date.now());
  await c.query("delete from video_obs_cache where video_id='q'");await c.query(request.text,request.values as any[]);assert.equal((await tuple()).requires_bootstrap,true);
 }finally{
  await c?.end();if(started)execFileSync('pg_ctl',['-D',data,'-m','immediate','-w','stop'],{stdio:'pipe'});
 }
});
