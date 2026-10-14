// Read-only production canary. Never invokes the fitter or writes score_params/source rows.
// Scope <=20 videos, <=5000 legacy observations, <=2MB changed bodies, <=5MB total results.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import pg from 'pg';import dotenv from 'dotenv';
import {ExportRowMirror,mirrorPageSql} from '../lib/readings/export-row-mirror';
import {loadPaidFitRows,PAID_FIT_SPEC,LEGACY_PAID_FIT_RECORDS_SQL,LEGACY_PAID_FIT_TRUTH_SQL} from '../lib/scoring/paid-fit-mirror';
import {DAY_BUCKETS,growthExponent,fitParams} from '../lib/scoring/core';import {longformSql} from '../lib/scoring/longform';
dotenv.config({path:process.env.PAID_FIT_ENV_FILE??'.env.local',quiet:true});
const client=new pg.Client({connectionString:process.env.DATABASE_URL,application_name:'paid-fit-bounded-canary'});
let total=0;let mirror:ExportRowMirror|undefined;
try{
 await client.connect();await client.query('begin isolation level repeatable read read only');await client.query("set local statement_timeout='30s';set local lock_timeout='3s'");
 const q=async(sql:string,values?:any[])=>{const rows=(await client.query(sql,values)).rows;total+=Buffer.byteLength(JSON.stringify(rows));if(total>5_000_000)throw Error('canary total response byte budget exceeded');return rows;};
 const exportDir=path.join(os.homedir(),'.cache','video-scripter','table-exports');
 const snapshotFile=fs.readdirSync(exportDir).find(f=>/^view_snapshots-[a-f0-9]+\.sqlite$/.test(f));
 if(!snapshotFile)throw Error('canary requires existing local snapshot mirror for bounded seed selection');
 const seedDb=new DatabaseSync(path.join(exportDir,snapshotFile),{readOnly:true});const seeds=new Set<string>();
 try{for(const row of seedDb.prepare('select body from rows limit 10000').iterate()){
  const r=JSON.parse(String(row.body));if(Number(r.days_since_published)>=27&&Number(r.days_since_published)<=33&&Number(r.view_count)>0)seeds.add(String(r.video_id));if(seeds.size>=100)break;
 }}finally{seedDb.close();}
 if(!seeds.size)throw Error('bounded local seed scan found no day30 observations');
 const ids=(await q(`select v.id from videos v where v.id=any($1::text[]) and v.published_at>now()-interval '18 months' and ${longformSql('v')}
  and exists(select 1 from view_snapshots s where s.video_id=v.id and s.days_since_published between 27 and 33 and s.view_count>0)
  order by v.id limit 20`,[[...seeds]])).map(r=>String(r.id));
 if(!ids.length)throw Error('canary found no eligible fitting inputs');
 const explain=await q('explain (analyze,buffers,format json) '+mirrorPageSql(PAID_FIT_SPEC),[ids,{},2_000_000]);
 const nodes:any[]=[];const visit=(p:any)=>{nodes.push(p);for(const n of p.Plans??[])visit(n);};visit(explain[0]['QUERY PLAN'][0].Plan);
 const bad=nodes.filter(n=>n['Node Type']==='Seq Scan'&&['videos','view_samples','view_snapshots'].includes(n['Relation Name']));
 if(bad.length)throw Error('canary source sequential scan gate failed');
 const dir=process.env.PAID_FIT_CANARY_DIR??fs.mkdtempSync(path.join(os.tmpdir(),'paid-fit-canary-'));fs.mkdirSync(dir,{recursive:true,mode:0o700});
 mirror=new ExportRowMirror(path.join(dir,'fit.sqlite'));mirror.bind('bounded-production-canary:'+ids.join(','));
 let before=total;const cold=await loadPaidFitRows(q,mirror,ids,{maxBytes:2_000_000,maxRows:5000});const coldBytes=total-before;
 before=total;const warm=await loadPaidFitRows(q,mirror,ids,{maxBytes:2_000_000,maxRows:5000});const warmBytes=total-before;
 assert.deepEqual(warm,cold);
 const points=await q(LEGACY_PAID_FIT_RECORDS_SQL,[ids,5001]);if(points.length>5000)throw Error('canary legacy source row budget exceeded');
 const truths=new Map((await q(LEGACY_PAID_FIT_TRUTH_SQL,[ids])).map(r=>[r.video_id,Number(r.view_count)]));
 const expected=ids.flatMap(id=>{const snaps=points.filter(r=>r.video_id===id).map(r=>({day:Number(r.day),views:Number(r.views)}));return DAY_BUCKETS.filter(b=>b<30).flatMap(b=>{const tol=b<=3?1:b<=7?2:3;const near=snaps.filter(s=>Math.abs(s.day-b)<=tol).sort((a,z)=>Math.abs(a.day-b)-Math.abs(z.day-b))[0];return near&&truths.get(id)?[{bucket:b,vt:near.views,v30:truths.get(id)!,q:growthExponent(snaps.filter(s=>s.day<=near.day+1e-9))}]:[];});});
 assert.deepEqual(cold,expected);assert.deepEqual(fitParams(cold,'canary'),fitParams(expected,'canary'));
 await client.query('rollback');
 console.log(JSON.stringify({videos:ids.length,sourceRows:points.length,fitRows:cold.length,coldBytes,warmBytes,totalBytes:total,executionMs:explain[0]['QUERY PLAN'][0]['Execution Time'],sourceSequentialScans:bad.length,exactParity:true,cacheDir:dir,plan:explain[0]['QUERY PLAN'][0]},null,2));
}finally{mirror?.close();await client.query('rollback').catch(()=>{});await client.end();}
