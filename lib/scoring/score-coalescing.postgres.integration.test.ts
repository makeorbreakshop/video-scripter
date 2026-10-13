// Isolated native PostgreSQL. Never loads credentials or contacts production.
// RUN_LOCAL_PG_TESTS=1 node --import tsx --test lib/scoring/score-coalescing.postgres.integration.test.ts
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import pg from 'pg';
import {scoreDirtyTargetsSql,SCORE_DIRTY_CLEAR_SQL,SCORE_DIRTY_DEFER_SQL} from './materialization-queue';

test('pending scores coalesce, but processing and commit-order races preserve new work', {
 skip:process.env.RUN_LOCAL_PG_TESTS!=='1',timeout:60000,
},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'score-coalesce-')),data=path.join(dir,'data');
 let started=false;const clients:pg.Client[]=[];
 try{
  execFileSync('initdb',['-D',data,'--no-locale','--auth-local=trust','--auth-host=reject'],{stdio:'pipe'});
  execFileSync('pg_ctl',['-D',data,'-l',path.join(dir,'server.log'),'-o',`-k ${dir} -h '' -c shared_buffers=16MB`,'-w','start'],{stdio:'pipe'});started=true;
  const connect=async()=>{const c=new pg.Client({host:dir,database:'postgres',user:os.userInfo().username});await c.connect();clients.push(c);await c.query("set statement_timeout='10s'");return c;};
  const c=await connect(),producer=await connect(),worker=await connect();
  await c.query(`create sequence pipeline_generation_seq;
   create table videos(id text primary key,channel_id text,published_at timestamptz,import_date timestamptz,privacy_status text,is_short boolean,duration text,shorts_checked_at timestamptz,view_count bigint);
   create table observation_materialization_meta(singleton boolean,capture_started_at timestamptz);
   insert into observation_materialization_meta values(true,now()-interval '1 year');
   create table video_scores(video_id text primary key,scored_at timestamptz);
   create table video_obs_cache(video_id text primary key,format int);
   create table observation_change_log(change_id bigserial primary key,video_id text,source text,operation text,at timestamptz,views bigint,time_basis text,received_at timestamptz,model_eligible boolean,conflicted boolean);
   create table obs_cache_dirty(video_id text primary key,generation bigint,requires_bootstrap boolean,marked_at timestamptz,not_before timestamptz);
   create table score_dirty(video_id text primary key,generation bigint,reason text,marked_at timestamptz,not_before timestamptz,attempts int default 0,claimed_at timestamptz,waiting_on text[],waiting_until timestamptz,ready_at timestamptz);
   create table series_dirty(video_id text primary key,marked_at timestamptz,generation bigint);
   insert into videos values('v','channel',now()-interval '2 days',now(),'public',false,'PT10M',now(),100);
   insert into video_scores values('v',now()-interval '2 hours');`);
  const migration='sql/2026-10-13-score-queue-coalescing.sql';
  await c.query(fs.readFileSync(fs.existsSync(migration)?migration:'sql/2026-09-28-materialization-cadence.sql','utf8'));
  let observations=0;
  const enqueue=async(db:pg.Client)=>db.query('select enqueue_observation_changes($1::jsonb)',[JSON.stringify([{video_id:'v',source:'rss',operation:'upsert',at:new Date().toISOString(),views:++observations}])]);
  const state=async()=> (await c.query('select *,ctid::text as tuple from score_dirty')).rows[0];
  const claim=async(db=c)=>{const q=scoreDirtyTargetsSql({limit:1,channels:[]});return (await db.query(q.text,q.values)).rows[0];};
  const clear=async(row:any)=>c.query(SCORE_DIRTY_CLEAR_SQL,[JSON.stringify([{video_id:row.id,generation:Number(row.generation)}])]);
  await enqueue(c);const first=await state();
  for(let i=0;i<20;i++)await enqueue(c);
  assert.equal((await state()).tuple,first.tuple,'pending marks must not rewrite the queue row');
  assert.equal(Number((await c.query('select count(*) n from observation_change_log')).rows[0].n),21,'all evidence remains');
  const selected=await claim();assert.ok((await state()).claimed_at);
  await enqueue(c);await clear(selected);assert.ok(await state(),'arrival during scoring survives old acknowledgement');
  const current=await claim();await c.query(SCORE_DIRTY_DEFER_SQL,[JSON.stringify([{video_id:current.id,generation:Number(current.generation)}]),300]);
  assert.equal((await state()).claimed_at,null,'deferral releases the processing marker');
  // Keep an earlier due time (including an urgent model rollout) and preserve its reason.
  await c.query("update score_dirty set reason='model-rollout',not_before=now()-interval '3 hours'");
  const due=(await state()).not_before;
  await enqueue(c);assert.equal((await state()).reason,'model-rollout');assert.equal((await state()).not_before.getTime(),due.getTime());
  // A producer has logged evidence and locked the coalesced row, but has not committed.
  await producer.query('begin');await enqueue(producer);
  let finished=false;const waiting=claim(worker).then(x=>{finished=true;return x;});
  await new Promise(r=>setTimeout(r,100));assert.equal(finished,false,'claim must wait for preceding writer');
  await producer.query('commit');const raced=await waiting;
  assert.equal(Number((await worker.query('select count(*) n from observation_change_log')).rows[0].n),observations,'post-claim read sees preceding commit');
  await clear(raced);assert.equal(await state(),undefined);
  await enqueue(c);assert.ok(await state(),'arrival after delete creates new work');
  // Claimed marker after a crashed worker fails safe: incoming work changes generation.
  const crashed=await claim();await enqueue(c);await clear(crashed);assert.ok(await state());
 }finally{
  for(const c of clients)await c.end().catch(()=>{});
  if(started)execFileSync('pg_ctl',['-D',data,'-m','immediate','-w','stop'],{stdio:'pipe'});
 }
});
