// Read-only validation of real, already-committed API samples. Bounded local5000 hints,
// 10video IDs x10indexed latest events, <=50KB returned canonical reference payload.
import fs from 'node:fs';import {DatabaseSync} from 'node:sqlite';import pg from 'pg';import dotenv from 'dotenv';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
import {observationCandidatesPath,OBSERVATION_CANONICAL_SQL} from '../lib/scoring/observation-candidates';
dotenv.config({path:process.env.PAID_FIT_ENV_FILE??'.env.local'});
const since=Number(process.env.API_CANDIDATE_SINCE_MS);if(!Number.isFinite(since)||since<1)throw Error('API_CANDIDATE_SINCE_MS required');
const file=observationCandidatesPath();if(!fs.existsSync(file))throw Error('no installed producer candidate cache');
const local=new DatabaseSync(file,{readOnly:true});const hints=new Map<string,string>();const held=new Map<string,string>();
try{for(const r of local.prepare('select version,body from candidates where created_at>=? order by created_at desc limit 5000').iterate(since)){
 const body=String(r.body);if(createHash('md5').update(body).digest('hex')!==r.version)continue;const a=JSON.parse(body);held.set(String(r.version),body);
 if(a[1]==='sample'&&a[2]==='upsert'&&!hints.has(a[0]))hints.set(a[0],String(r.version));if(hints.size>=10)break;
}}finally{local.close();}
if(hints.size<10)throw Error('await normal API commit: fewer than10fresh sample candidates');
const c=new pg.Client({connectionString:process.env.DATABASE_URL,application_name:'api-candidate-bounded-canary'});
try{
 await c.connect();await c.query('begin read only');await c.query("set local statement_timeout='10s';set local lock_timeout='3s'");
 const result=(await c.query(`with refs as materialized (
  select l.video_id,l.change_id::text,l.source,l.operation,md5(${OBSERVATION_CANONICAL_SQL}) as version
   from unnest($1::text[]) v(id) cross join lateral (
    select * from observation_change_log where video_id=v.id order by change_id desc limit 10
   ) l
 ), payload as(select coalesce(json_agg(refs),'[]'::json)::text as body from refs)
 select octet_length(body) as bytes,case when octet_length(body)<=50000 then body else null end as body from payload`,[[...hints.keys()]])).rows[0];
 if(!result.body)throw Error('API reference byte budget exceeded');const rows=JSON.parse(result.body);assert.ok(rows.length<=100);
 const committed=new Set(rows.map((r:any)=>r.version));for(const [id,version]of hints)assert.ok(committed.has(version),`fresh API hint for ${id} must match a committed event`);
 const hits=rows.filter((r:any)=>held.has(r.version)).length;
 await c.query('rollback');console.log(JSON.stringify({sampleHints:hints.size,allSampleHintsMatchCommittedEvents:true,referenceRows:rows.length,heldMatches:hits,serializedReferenceBytes:Number(result.bytes)},null,2));
}finally{await c.query('rollback').catch(()=>{});await c.end();}
