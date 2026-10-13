import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir,userInfo } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { ExportRowMirror,syncExportMirror,type ExportMirrorSpec } from './export-row-mirror';

test('fresh exports reuse unchanged rows and faithfully apply inserts, corrections, deletes and duplicate video dates', {skip:process.env.RUN_LOCAL_PG_TESTS!=='1',timeout:60000}, async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'export-mirror-pg-')),data=path.join(dir,'pg');
 execFileSync('initdb',['-D',data,'--no-locale','--auth-local=trust','--auth-host=reject'],{stdio:'pipe'});
 execFileSync('pg_ctl',['-D',data,'-l',path.join(dir,'pg.log'),'-o',`-k ${dir} -h '' -c shared_buffers=16MB`,'-w','start'],{stdio:'pipe'});
 const c=new pg.Client({host:dir,database:'postgres',user:userInfo().username});await c.connect();
 let mirror=new ExportRowMirror(path.join(dir,'cache.sqlite'));
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
  // A valid JSON body can be corrupted while its stored fingerprint is intact.
  const disk=new DatabaseSync(path.join(dir,'cache.sqlite'));
  disk.prepare('update rows set body=? where key=?').run(JSON.stringify({id:uuid(4),video_id:'wrong',snapshot_date:'2026-10-13',views:123456}),uuid(4));
  disk.close();
  const repaired=await syncExportMirror(mirror,spec,query,options);
  assert.equal(repaired.changed,1,'a corrupt local body must be refetched, not accepted as unchanged');
  assert.deepEqual([...mirror.rows()],(await c.query('select id,video_id,snapshot_date::text,views from fixture order by id')).rows);
  await c.query('delete from fixture where id=any($1::uuid[])',[[uuid(0),uuid(2),uuid(8)]]);
  await c.query('update fixture set views=900 where id=$1',[uuid(4)]);
  for(const n of [1,3,5,7,9])await c.query("insert into fixture values($1,'same-video','2026-10-13',$2)",[uuid(n),n]);
  const corrected=await syncExportMirror(mirror,spec,query,options);assert.equal(corrected.changed,6);
  const expected=(await c.query('select id,video_id,snapshot_date::text,views from fixture order by id')).rows;
  assert.deepEqual([...mirror.rows()],expected);
  const warmAgain=await syncExportMirror(mirror,spec,query,options);assert.equal(warmAgain.bytes,0);
  mirror.close();mirror=new ExportRowMirror(path.join(dir,'cache.sqlite'));mirror.bind(JSON.stringify(spec));
  assert.equal((await syncExportMirror(mirror,spec,query,options)).bytes,0,'restart reuses the complete verified mirror');
  // Execute the production export entrypoint against this isolated database and decode
  // its actual Parquet output. Retain the transient file only in the test child process.
  await c.query(`create view view_snapshots as select id,video_id,snapshot_date,views as view_count,
    null::bigint like_count,null::bigint comment_count,null::int days_since_published,
    '2026-10-13'::timestamptz created_at from fixture`);
  const captureSql=(await import('node:fs')).readFileSync(path.join(process.cwd(),'sql/2026-10-13-incremental-mirrors.sql'),'utf8').split('-- Fixture databases')[0];
  await c.query(captureSql);await c.query("select install_mirror_capture('view_snapshots','fixture','id','id,video_id,snapshot_date,views')");
  const artifact=path.join(dir,'verified.parquet'),capture=path.join(dir,'capture.mjs');
  writeFileSync(capture,`import {promises as fs} from 'node:fs';
    const remove=fs.rm;fs.rm=async(p,o)=>String(p).endsWith('.parquet')?fs.rename(p,process.env.TEST_PARQUET_PATH):remove(p,o);`);
  const run=()=>execFileSync(process.execPath,['--import','tsx','--import',capture,
    path.join(process.cwd(),'scripts/export-tables.ts'),'--dry-run','--tables','view_snapshots',
    '--cache-dir',path.join(dir,'export-cache'),'--batch','2','--max-rows','100','--max-response-bytes','100000'],{
    cwd:process.cwd(),encoding:'utf8',env:{...process.env,TMPDIR:dir,TEST_PARQUET_PATH:artifact,
      DATABASE_URL:`postgresql://${userInfo().username}@localhost/postgres?host=${encodeURIComponent(dir)}`},
  });
  assert.match(run(),new RegExp(`${expected.length}/${expected.length} changed`));
  assert.match(run(),new RegExp(`0/${expected.length} changed`));
  const pq:any=await import('parquetjs-lite');const reader=await (pq.ParquetReader??pq.default.ParquetReader).openFile(artifact);
  try{
    const cursor=reader.getCursor();const exported=[];let r;
    while((r=await cursor.next()))exported.push({video_id:r.video_id,snapshot_date:r.snapshot_date,views:Number(r.view_count)});
    const order=(a:any,b:any)=>a.views-b.views;
    assert.deepEqual(exported.sort(order),expected.map(({video_id,snapshot_date,views})=>({video_id,snapshot_date,views})).sort(order));
  }finally{await reader.close();}
  await c.query('delete from fixture');await syncExportMirror(mirror,spec,query,options);assert.deepEqual([...mirror.rows()],[]);
  await c.query("insert into fixture values($1,'too-big','2026-10-13',1)",[uuid(1)]);
  await assert.rejects(syncExportMirror(mirror,spec,query,{...options,maxBytes:1}),/byte budget/);
  assert.deepEqual([...mirror.rows()],[],'budget failure never supplies stale output');
  assert.throws(()=>mirror.bind('another-project'),/identity/);
 } finally {mirror.close();await c.end();execFileSync('pg_ctl',['-D',data,'-m','fast','-w','stop'],{stdio:'pipe'});}
});
