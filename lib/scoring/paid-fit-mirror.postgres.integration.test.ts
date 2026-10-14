import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';import pg from 'pg';
import {ExportRowMirror} from '../readings/export-row-mirror';import {DAY_BUCKETS,growthExponent,fitParams} from './core';
test('paid nightly fit reuses unchanged history while preserving fitted parameters and ambiguous SQL ties',{skip:process.env.RUN_LOCAL_PG_TESTS!=='1',timeout:60000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paid-fit-')),data=path.join(dir,'pg');let c:pg.Client|undefined;let mirror:ExportRowMirror|undefined;let started=false;
 try{
 execFileSync('initdb',['-D',data,'--no-locale','--auth-local=trust','--auth-host=reject'],{stdio:'pipe'});execFileSync('pg_ctl',['-D',data,'-l',path.join(dir,'pg.log'),'-o',`-k ${dir} -h '' -c shared_buffers=16MB`,'-w','start'],{stdio:'pipe'});started=true;
 c=new pg.Client({host:dir,database:'postgres',user:os.userInfo().username});await c.connect();
 await c.query(`set statement_timeout='10s';create table videos(id text primary key,published_at timestamptz);
 create table view_samples(video_id text,sampled_at timestamptz,view_count bigint);create index on view_samples(video_id,sampled_at);
 create table view_snapshots(video_id text,snapshot_date date,view_count bigint,days_since_published int);create index on view_snapshots(video_id);
 insert into videos values('v','2026-01-01');insert into view_samples select 'v','2026-01-01'::timestamptz+g*interval '1 hour',100+g from generate_series(1,1000)g;
 insert into view_snapshots values('v','2026-01-31',5000,30);`);
 let bytes=0;const q=async(sql:string,params?:any[])=>{const rows=(await c!.query(sql,params)).rows;bytes+=Buffer.byteLength(JSON.stringify(rows));return rows;};
 let ids=['v'];
 const original=async()=>{
 const points=await q(`select x.video_id,extract(epoch from(x.at-v.published_at))/86400.0 as day,x.views from (select video_id,snapshot_date::timestamptz+interval '12 hours' as at,view_count as views from view_snapshots where video_id=any($1) union all select video_id,sampled_at,view_count from view_samples where video_id=any($1)) x join videos v on v.id=x.video_id where x.views>0 and x.at>=v.published_at order by x.video_id,x.at`,[ids]);
 const truths=await q(`select distinct on(video_id) video_id,view_count from view_snapshots where video_id=any($1) and days_since_published between 27 and 33 and view_count>0 order by video_id,abs(days_since_published-30)`,[ids]);
 const truth=new Map(truths.map(r=>[r.video_id,Number(r.view_count)]));
 return ids.flatMap(id=>DAY_BUCKETS.filter(b=>b<30).flatMap(b=>{const tol=b<=3?1:b<=7?2:3;const ps=points.filter(r=>r.video_id===id).map(r=>({day:Number(r.day),views:Number(r.views)}));const near=ps.filter(s=>Math.abs(s.day-b)<=tol).sort((a,z)=>Math.abs(a.day-b)-Math.abs(z.day-b))[0];return near&&truth.get(id)?[{bucket:b,vt:near.views,v30:truth.get(id)!,q:growthExponent(ps.filter(s=>s.day<=near.day+1e-9))}]:[];}));
 };
 const file=path.join(process.cwd(),'lib/scoring/paid-fit-mirror.ts');const api=fs.existsSync(file)?await import(file):null;
 mirror=new ExportRowMirror(path.join(dir,'fit.sqlite'));mirror.bind('fixture');const load=()=>api?api.loadPaidFitRows(q,mirror!,ids):original();
 const expected=await original();bytes=0;const cold=await load();const coldBytes=bytes;assert.deepEqual(cold,expected);assert.deepEqual({...fitParams(cold),fittedAt:null},{...fitParams(expected),fittedAt:null});bytes=0;
 assert.deepEqual(await load(),expected);assert.ok(bytes<coldBytes/4,`unchanged paid history must not retransmit (${bytes} vs ${coldBytes})`);
 await c.query("update view_samples set view_count=12345 where sampled_at='2026-01-02';delete from view_samples where sampled_at='2026-01-03'");assert.deepEqual(await load(),await original());
 mirror.close();mirror=new ExportRowMirror(path.join(dir,'fit.sqlite'));mirror.bind('fixture');assert.deepEqual(await load(),await original());
 await c.query("insert into view_snapshots values('v','2026-01-02',999,1);delete from view_snapshots where days_since_published=30;insert into view_snapshots values('v','2026-01-30',4500,29),('v','2026-02-01',5500,31)");assert.deepEqual(await load(),await original(),'ambiguous ties retain original queries');
 // Population large enough to fit qBins, not only the default/single-video branches.
 await c.query(`insert into videos select 'p-'||g,'2026-01-01' from generate_series(1,60)g;
 insert into view_samples select v.id,'2026-01-01'::timestamptz+d*interval '1 day',(100+d*d*10)*(1+substring(v.id from 3)::int) from videos v cross join generate_series(1,24)d where v.id like 'p-%';
 insert into view_snapshots select id,'2026-01-31',100000,30 from videos where id like 'p-%'`);
 ids=Array.from({length:60},(_,i)=>'p-'+(i+1));
 const population=await original();const cached=await load();assert.deepEqual(cached,population);
 assert.deepEqual({...fitParams(cached),fittedAt:null},{...fitParams(population),fittedAt:null});
 assert.ok(Object.values(fitParams(population).qBins).some((b:any)=>b.edges.length===4),'fixture must exercise fitted q bins');
 await c.query("update videos set published_at=published_at+interval '1 hour' where id='p-1'");assert.deepEqual(await load(),await original(),'publish-time changes invalidate source ages');
 ids=['edge'];await c.query(`insert into videos values('edge','2026-01-01');insert into view_samples values('edge','2026-01-02',100),('edge','2026-01-25',1000),('edge','2026-01-25 00:00:00.000086',2000);insert into view_snapshots values('edge','2026-01-31',5000,30)`);
 assert.deepEqual(await load(),await original(),'growth exponent retains points within its 1e-9-day epsilon beyond the last selected reading');
 assert.equal(mirror.count(),1,'successful passes prune unselected optional inputs');
 const {DatabaseSync}=await import('node:sqlite');const corrupt=new DatabaseSync(path.join(dir,'fit.sqlite'));corrupt.exec("update rows set body='{}' where key='edge'");corrupt.close();assert.deepEqual(await load(),await original(),'corrupt held body is repaired by authoritative fingerprint');
 await c.query("delete from view_samples where video_id='edge'");assert.deepEqual(await load(),await original());
 await assert.rejects(api.loadPaidFitRows(q,mirror,['v'],{maxBytes:1}),/budget/);
 }finally{mirror?.close();await c?.end();if(started)execFileSync('pg_ctl',['-D',data,'-m','immediate','-w','stop'],{stdio:'pipe'});}
});
