import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';import pg from 'pg';
import {ExportRowMirror} from '../readings/export-row-mirror';
import {loadLaunchFitRows,LEGACY_LAUNCH_ROWS_SQL,LAUNCH_FIT_IDS_SQL} from './launch-fit-mirror';
import {fitLaunchLadderV5} from './growth';

test('launch fitting reuses unchanged source-validated history with identical inputs and model',{
 skip:process.env.RUN_LOCAL_PG_TESTS!=='1',timeout:60000,
},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'launch-fit-')),data=path.join(dir,'pg');let c:pg.Client|undefined;let mirror:ExportRowMirror|undefined;let started=false;
 try{
 execFileSync('initdb',['-D',data,'--no-locale','--auth-local=trust','--auth-host=reject'],{stdio:'pipe'});
 execFileSync('pg_ctl',['-D',data,'-l',path.join(dir,'server.log'),'-o',`-k ${dir} -h '' -c shared_buffers=16MB`,'-w','start'],{stdio:'pipe'});started=true;
 c=new pg.Client({host:dir,database:'postgres',user:os.userInfo().username});await c.connect();
 await c.query(`set statement_timeout='10s';set timezone='UTC';
 create table videos(id text primary key,published_at timestamptz,is_short boolean,duration text,shorts_checked_at timestamptz);
 create table view_samples(video_id text,sampled_at timestamptz,view_count bigint,primary key(video_id,sampled_at));
 create table view_snapshots(video_id text,snapshot_date date,view_count bigint);
 insert into videos values('v','2026-08-01',false,'PT10M',now()),('empty','2026-08-01',false,'PT10M',now());
 insert into view_samples select 'v','2026-08-01'::timestamptz+g*interval '1 minute',100+g from generate_series(1,1199) g;
 insert into view_samples values('v','2026-08-02',2000);`);
 let bytes=0;const q=async(sql:string,params?:any[])=>{const rows=(await c!.query(sql,params)).rows;bytes+=Buffer.byteLength(JSON.stringify(rows));return rows;};
 const legacy=async()=> (await q(LEGACY_LAUNCH_ROWS_SQL,['2026-08-01',['v','empty']])).map(r=>({hours:Number(r.hours),vh:Number(r.vh),v1:Number(r.v1)}));
 const sort=(r:any[])=>[...r].sort((a,b)=>a.hours-b.hours||a.vh-b.vh||a.v1-b.v1);
 mirror=new ExportRowMirror(path.join(dir,'fit.sqlite'));mirror.bind('fixture');
 const expected=await legacy();bytes=0;const first=await loadLaunchFitRows(q,mirror,['v','empty'],'2026-08-01');const coldBytes=bytes;
 assert.deepEqual(sort(first),sort(expected));assert.deepEqual(fitLaunchLadderV5(first,0),fitLaunchLadderV5(expected,0));
 bytes=0;const warm=await loadLaunchFitRows(q,mirror,['v','empty'],'2026-08-01');
 assert.deepEqual(sort(warm),sort(expected));assert.ok(bytes<coldBytes/4,`unchanged history must not be retransferred (${bytes} vs ${coldBytes})`);
 await c.query("update view_samples set view_count=9999 where sampled_at='2026-08-01 01:00';delete from view_samples where sampled_at='2026-08-01 02:00'");
 assert.deepEqual(sort(await loadLaunchFitRows(q,mirror,['v','empty'],'2026-08-01')),sort(await legacy()));
 mirror.close();mirror=new ExportRowMirror(path.join(dir,'fit.sqlite'));mirror.bind('fixture');bytes=0;
 assert.equal((await loadLaunchFitRows(q,mirror,['v','empty'],'2026-08-01')).length,1198);assert.ok(bytes<1000,'restart reuses verified bytes');
 await c.query("delete from view_samples where sampled_at='2026-08-02';insert into view_samples values('v','2026-08-01 23:00',1700),('v','2026-08-02 01:00',1900)");
 assert.deepEqual(sort(await loadLaunchFitRows(q,mirror,['v'],'2026-08-01')),sort(await legacy()),'ambiguous day1 ties retain the legacy selection path');
 await assert.rejects(loadLaunchFitRows(q,mirror,['v'],'2026-08-01',{maxRows:1}),/budget/);
 await assert.rejects(loadLaunchFitRows(q,mirror,['v'],'2026-08-01',{maxBytes:1}),/budget/);
 await c.query(`insert into videos select 'bulk-'||g,'2026-08-01',false,'PT10M',now() from generate_series(1,200001) g`);
 assert.equal((await q(LAUNCH_FIT_IDS_SQL,['2026-08-01'])).length,200003,'enumeration must cover the live population, not silently truncate at the former limit');
 await c.query("delete from videos where id='v'");assert.deepEqual(await loadLaunchFitRows(q,mirror,['v'],'2026-08-01'),[]);
 }finally{mirror?.close();await c?.end();if(started)execFileSync('pg_ctl',['-D',data,'-m','immediate','-w','stop'],{stdio:'pipe'});}
});
