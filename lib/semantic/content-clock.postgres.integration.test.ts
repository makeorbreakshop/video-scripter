import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';import pg from 'pg';
test('view-only writes do not schedule unchanged semantic text; actual edits and old unprocessed edits remain visible', {skip:process.env.RUN_LOCAL_PG_TESTS!=='1',timeout:60000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'content-clock-')),data=path.join(dir,'pg');
 execFileSync('initdb',['-D',data,'--no-locale','--auth-local=trust','--auth-host=reject'],{stdio:'pipe'});
 execFileSync('pg_ctl',['-D',data,'-l',path.join(dir,'pg.log'),'-o',`-k ${dir} -h '' -c shared_buffers=16MB`,'-w','start'],{stdio:'pipe'});
 const c=new pg.Client({host:dir,database:'postgres',user:os.userInfo().username});await c.connect();
 try{
  await c.query(`create table videos(id text primary key,title text,description text,channel_name text,channel_id text,
    topic_domain text,topic_niche text,topic_micro text,format_type text,privacy_status text,is_short bool,is_institutional bool,duration text,
    published_at timestamptz,updated_at timestamptz,view_count bigint);
    insert into videos(id,title,updated_at,published_at,view_count) values('v','original','2026-10-01','2026-10-01',1),('pending','old-unprocessed','2026-10-12','2026-10-01',1)`);
  const migration=path.join(process.cwd(),'sql/2026-10-13-semantic-content-clock.sql');
  if(fs.existsSync(migration))await c.query(fs.readFileSync(migration,'utf8'));else await c.query('alter table videos add semantic_changed_at timestamptz');
  const due=async()=> (await c.query("select id from videos v where coalesce(v.semantic_changed_at,v.updated_at)>='2026-10-10' order by id")).rows.map(r=>r.id);
  await c.query("update videos set view_count=2,updated_at=now() where id='v'");
  assert.deepEqual(await due(),['pending'],'view-only update must not rehydrate previously processed content');
  await c.query("update videos set title='edited',updated_at=now() where id='v'");assert.deepEqual(await due(),['pending','v']);
  const clock=async()=> (await c.query("select semantic_changed_at::text t from videos where id='v'")).rows[0].t;
  const before=await clock();await c.query("update videos set title=title,updated_at=now(),view_count=3 where id='v'");assert.equal(await clock(),before);
  await c.query("update videos set description='new description' where id='v'");assert.notEqual(await clock(),before);
  await c.query("insert into videos(id,title,published_at) values('new','new','2026-10-01')");assert.deepEqual(await due(),['new','pending','v']);
  await c.query("insert into videos(id,title,published_at,is_institutional) values('institution','eligible','2026-10-01',true)");
  await c.query("update videos set semantic_changed_at='2026-10-01' where id='institution'");
  // Establish an old clock before toggling catalog eligibility.
  await c.query('alter table videos disable trigger track_semantic_content_change');
  await c.query("update videos set semantic_changed_at='2026-10-01' where id='institution'");
  await c.query('alter table videos enable trigger track_semantic_content_change');
  await c.query("update videos set is_institutional=false,updated_at=now() where id='institution'");
  assert.equal((await c.query("select count(*)::int n from videos v where id='institution' and coalesce(v.is_institutional,false)=false and coalesce(v.semantic_changed_at,v.updated_at)>='2026-10-10'")).rows[0].n,1,'newly eligible catalog content must be revisited');
  const moduleFile=path.join(process.cwd(),'lib/semantic/change-window.ts');
  assert.ok(fs.existsSync(moduleFile),'indexed change windows must provide a bounded cursor before content filters');
  const {readSemanticChangeWindow}=await import(moduleFile);
  let cursor=null;const found:string[]=[];
  for(let page=0;page<20;page++){
   const window=await readSemanticChangeWindow(c,'2026-10-10',cursor,2);
   found.push(...window.ids);if(window.done)break;cursor=window.cursor;
  }
  assert.deepEqual([...found].sort(),['institution','new','pending','v']);
  assert.equal(new Set(found).size,found.length,'equal clocks must not duplicate or skip keys');
  await c.query('begin');const prev=await clock();await c.query("update videos set topic_niche='changed' where id='v'");await c.query('rollback');assert.equal(await clock(),prev);
 }finally{await c.end();execFileSync('pg_ctl',['-D',data,'-m','immediate','-w','stop'],{stdio:'pipe'});}
});
