import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir,userInfo } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { ExportRowMirror,syncExportMirror,type ExportMirrorSpec } from './export-row-mirror';

test('fresh exports reuse unchanged rows and faithfully apply inserts, corrections, deletes and duplicate video dates', {timeout:60000}, async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'export-mirror-pg-')),data=path.join(dir,'pg');
 execFileSync('initdb',['-D',data,'--no-locale','--auth-local=trust','--auth-host=reject'],{stdio:'pipe'});
 execFileSync('pg_ctl',['-D',data,'-l',path.join(dir,'pg.log'),'-o',`-k ${dir} -h '' -c shared_buffers=16MB`,'-w','start'],{stdio:'pipe'});
 const c=new pg.Client({host:dir,database:'postgres',user:userInfo().username});await c.connect();
 const mirror=new ExportRowMirror(path.join(dir,'cache.sqlite'));
 const spec:ExportMirrorSpec={name:'fixture',from:'fixture',key:'id',keyType:'uuid',projection:'id,video_id,snapshot_date::text,views'};
 const options={batch:2,maxRows:100,maxBytes:100000};
 const uuid=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
 try {
  mirror.bind(JSON.stringify(spec));
  await c.query('create table fixture(id uuid primary key,video_id text,snapshot_date date,views int)');
  for(const n of [0,2,4,6,8])await c.query("insert into fixture values($1,'same-video','2026-10-13',$2)",[uuid(n),n]);
  const query=async(sql:string,values:unknown[])=>c.query(sql,values);
  const first=await syncExportMirror(mirror,spec,query,options);assert.equal(first.changed,5);
  const warm=await syncExportMirror(mirror,spec,query,options);assert.equal(warm.changed,0);assert.equal(warm.bytes,0);
  await c.query('delete from fixture where id=any($1::uuid[])',[[uuid(0),uuid(2),uuid(8)]]);
  await c.query('update fixture set views=900 where id=$1',[uuid(4)]);
  for(const n of [1,3,5,7,9])await c.query("insert into fixture values($1,'same-video','2026-10-13',$2)",[uuid(n),n]);
  const corrected=await syncExportMirror(mirror,spec,query,options);assert.equal(corrected.changed,6);
  const expected=(await c.query('select id,video_id,snapshot_date::text,views from fixture order by id')).rows;
  assert.deepEqual([...mirror.rows()],expected);
  const warmAgain=await syncExportMirror(mirror,spec,query,options);assert.equal(warmAgain.bytes,0);
  await c.query('delete from fixture');await syncExportMirror(mirror,spec,query,options);assert.deepEqual([...mirror.rows()],[]);
  await c.query("insert into fixture values($1,'too-big','2026-10-13',1)",[uuid(1)]);
  await assert.rejects(syncExportMirror(mirror,spec,query,{...options,maxBytes:1}),/byte budget/);
  assert.deepEqual([...mirror.rows()],[],'budget failure never supplies stale output');
  assert.throws(()=>mirror.bind('another-project'),/identity/);
 } finally {mirror.close();await c.end();execFileSync('pg_ctl',['-D',data,'-m','fast','-w','stop'],{stdio:'pipe'});}
});
