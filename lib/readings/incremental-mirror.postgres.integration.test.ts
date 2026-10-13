import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {execFileSync} from 'node:child_process';import pg from 'pg';
import {DatabaseSync} from 'node:sqlite';
import * as api from './export-row-mirror';

test('warm exports read changes only, survive late commits, replay and corrupt local rows', {skip:process.env.RUN_LOCAL_PG_TESTS!=='1',timeout:90000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'incremental-export-')),data=path.join(dir,'pg');
 execFileSync('initdb',['-D',data,'--no-locale','--auth-local=trust','--auth-host=reject'],{stdio:'pipe'});
 execFileSync('pg_ctl',['-D',data,'-l',path.join(dir,'pg.log'),'-o',`-k ${dir} -h '' -c shared_buffers=16MB`,'-w','start'],{stdio:'pipe'});
 const connect=async()=>{const c=new pg.Client({host:dir,database:'postgres',user:os.userInfo().username});await c.connect();await c.query("set statement_timeout='5s';set lock_timeout='1s'");return c;};
 const c=await connect(),other=await connect();const file=path.join(dir,'mirror.sqlite');let mirror=new api.ExportRowMirror(file);
 const spec:api.ExportMirrorSpec={name:'fixture',from:'fixture',key:'id',keyType:'text',projection:'id,views'};
 const queries:string[]=[];const q=async(sql:string,params:unknown[])=>{queries.push(sql);return c.query(sql,params);};
 const options={batch:2,maxRows:100,maxBytes:100000,owner:'fixture-owner'};
 const sync=()=>typeof (api as any).syncIncrementalMirror==='function'?(api as any).syncIncrementalMirror(mirror,spec,q,options):api.syncExportMirror(mirror,spec,q,options);
 try{
  await c.query('create table fixture(id text primary key,views int);insert into fixture values(\'a\',1),(\'b\',2),(\'c\',3)');
  const migration=path.join(process.cwd(),'sql/2026-10-13-incremental-mirrors.sql');
  if(fs.existsSync(migration)){
   await c.query(fs.readFileSync(migration,'utf8'));
   await c.query("select install_mirror_capture('fixture','fixture','id','id,views')");
  }
  mirror.bind('fixture');await sync();queries.length=0;const warm=await sync();
  assert.equal(warm.changed,0);
  assert.equal(queries.filter(s=>/SELECT id::text AS key FROM fixture/i.test(s)).length,0,'unchanged warm sync must not enumerate the entire table');
  assert.deepEqual([...mirror.rows()],(await c.query('select * from fixture order by id')).rows);
  await c.query("update fixture set views=99 where id='a';delete from fixture where id='b';insert into fixture values('d',4)");
  await sync();assert.deepEqual([...mirror.rows()],(await c.query('select * from fixture order by id')).rows);
  // A lower allocated sequence can COMMIT after a higher sequence was consumed.
  await other.query('begin');await other.query("insert into fixture values('late',7)");
  await c.query("insert into fixture values('early',8)");await sync();await other.query('commit');await sync();
  assert.deepEqual([...mirror.rows()],(await c.query('select * from fixture order by id')).rows);
  await c.query("update fixture set views=views where id='a'");
  assert.equal((await c.query("select count(*)::int n from mirror_dirty where dataset='fixture'")).rows[0].n,0,'equivalent update adds no work');
  await c.query("update fixture set views=100 where id='a'");
  let acknowledged=false;
  const failedQ=async(sql:string,params:unknown[])=>{if(sql.includes('mirror.ack')&&!acknowledged){acknowledged=true;throw Error('crash before ack');}return q(sql,params);};
  await assert.rejects((api as any).syncIncrementalMirror(mirror,spec,failedQ,options),/crash before ack/);
  mirror.close();mirror=new api.ExportRowMirror(file);mirror.bind('fixture');await sync();
  assert.deepEqual([...mirror.rows()],(await c.query('select * from fixture order by id')).rows);
  const disk=new DatabaseSync(file);disk.prepare('update rows set body=? where key=?').run('{"id":"a","views":-1}','a');disk.close();
  await sync();assert.equal([...mirror.rows()].find(r=>r.id==='a')?.views,100,'corrupt unchanged local row repairs from authoritative data');
  const alien=new api.ExportRowMirror(path.join(dir,'alien.sqlite'));alien.bind('fixture');
  try{await assert.rejects((api as any).syncIncrementalMirror(alien,spec,q,{...options,owner:'another-host'}),/owner/);}finally{alien.close();}
  // A producer changing the claimed generation during hydration cannot be acknowledged away.
  await c.query("update fixture set views=101 where id='a'");let raced=false;
  const raceQ=async(sql:string,params:unknown[])=>{const result=await q(sql,params);if(sql.includes('mirror.claim')&&!raced){raced=true;await other.query("update fixture set views=102 where id='a'");}return result;};
  await (api as any).syncIncrementalMirror(mirror,spec,raceQ,options);
  assert.equal((await c.query("select count(*)::int n from mirror_dirty where dataset='fixture'")).rows[0].n,1);
  await sync();assert.equal([...mirror.rows()].find(r=>r.id==='a')?.views,102);
  await c.query("update fixture set id='renamed' where id='a'");await sync();assert.deepEqual([...mirror.rows()],(await c.query('select * from fixture order by id')).rows);
  const broken=new DatabaseSync(file);broken.exec("delete from rows where key='c'");broken.close();
  await assert.rejects(sync(),/completeness/,'missing local rows must never publish an incomplete export');
  // Explicit bounded rebuild establishes a new authoritative receipt.
  mirror.setMetadata('capture-epoch','rebuild');await sync();
  mirror.close();const saved=fs.readFileSync(file);mirror=new api.ExportRowMirror(file);
  await c.query("update fixture set views=900 where id='c'");await sync();mirror.close();
  fs.writeFileSync(file,saved);mirror=new api.ExportRowMirror(file);
  await assert.rejects(sync(),/checkpoint/,'a valid old SQLite backup cannot silently replace acknowledged data');
  mirror.setMetadata('capture-epoch','rebuild');await sync();
  await c.query('truncate fixture');await sync();assert.equal(mirror.count(),0,'truncate invalidates the captured corpus');

 }finally{mirror.close();await other.end();await c.end();execFileSync('pg_ctl',['-D',data,'-m','immediate','-w','stop'],{stdio:'pipe'});}
});
