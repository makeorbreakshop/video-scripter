import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';import pg from 'pg';
import {OBS_CHANGES_FOR_CLAIMS_SQL} from './observation-materializer';
test('materializer reuses producer data only when the authoritative event digest matches', {skip:process.env.RUN_LOCAL_PG_TESTS!=='1',timeout:60000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'obs-candidates-')),data=path.join(dir,'pg');
 execFileSync('initdb',['-D',data,'--no-locale','--auth-local=trust','--auth-host=reject'],{stdio:'pipe'});
 execFileSync('pg_ctl',['-D',data,'-l',path.join(dir,'pg.log'),'-o',`-k ${dir} -h '' -c shared_buffers=16MB`,'-w','start'],{stdio:'pipe'});
 const c=new pg.Client({host:dir,database:'postgres',user:os.userInfo().username});await c.connect();let store:any;
 try{
  await c.query(`create table observation_change_log(change_id bigserial primary key,video_id text,source text,operation text,at timestamptz,views bigint,time_basis text,received_at timestamptz,model_eligible bool,conflicted bool);
    insert into observation_change_log(video_id,source,operation,at,views,time_basis,received_at,model_eligible,conflicted)
    select 'v','rss','upsert','2026-10-13'::timestamptz+g*interval '1 second',g,'response-date-estimate','2026-10-13'::timestamptz+g*interval '1 second',true,false from generate_series(1,100)g`);
  const claims=JSON.stringify([{video_id:'v',generation:100,last_change_id:0}]);
  const expected=(await c.query(OBS_CHANGES_FOR_CLAIMS_SQL,[claims,101])).rows;
  const modulePath=path.join(process.cwd(),'lib/scoring/observation-candidates.ts');const api=fs.existsSync(modulePath)?await import(modulePath):null;
  if(api){store=new api.ObservationCandidates(path.join(dir,'cache.sqlite'));store.putRss(expected.map((r:any)=>({...r,at:r.at.toISOString(),received_at:r.received_at.toISOString()})));}
  const cold=new api.ObservationCandidates(path.join(dir,'cold.sqlite'));const coldQueries:string[]=[];
  const coldClient={query:async(sql:string,values:any[])=>{coldQueries.push(sql);return c.query(sql,values);}};
  try{
   await api.loadVerifiedObservationChanges(coldClient,claims,101,cold);
   assert.ok(coldQueries.some(s=>s===OBS_CHANGES_FOR_CLAIMS_SQL),'cold candidates should fall back after a tiny probe, not download all references plus all bodies');
  }finally{cold.close();}
  let bytes=0;const client={query:async(sql:string,values:any[])=>{const r=await c.query(sql,values);bytes+=Buffer.byteLength(JSON.stringify(r.rows));return r;}};
  const load=()=>api?api.loadVerifiedObservationChanges(client,claims,101,store):client.query(OBS_CHANGES_FOR_CLAIMS_SQL,[claims,101]).then(r=>r.rows);
  const normalize=(rs:any[])=>rs.map(r=>({...r,at:new Date(r.at).toISOString(),received_at:r.received_at?new Date(r.received_at).toISOString():null}));
  assert.deepEqual(normalize(await load()),normalize(expected));
  assert.ok(bytes<Buffer.byteLength(JSON.stringify(expected))*0.6,'matched producer rows should transfer compact digests instead of full observations');
  // A cache candidate is NOT authority: changed or absent rows must use database bytes.
  await c.query("update observation_change_log set views=999,conflicted=true,model_eligible=false where change_id=1;delete from observation_change_log where change_id=2");
  assert.deepEqual(normalize(await load()),normalize((await c.query(OBS_CHANGES_FOR_CLAIMS_SQL,[claims,101])).rows));
  store.close();store=new api.ObservationCandidates(path.join(dir,'cache.sqlite'));
  assert.deepEqual(normalize(await load()),normalize((await c.query(OBS_CHANGES_FOR_CLAIMS_SQL,[claims,101])).rows));
 }finally{store?.close();await c.end();execFileSync('pg_ctl',['-D',data,'-m','immediate','-w','stop'],{stdio:'pipe'});}
});
