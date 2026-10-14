// Producer-held values are hints, never authority. Only a digest returned for a committed
// change_id admits local bytes. Replayed/conflicted/SQL-transformed input misses safely.
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import fs from 'node:fs';import path from 'node:path';

const hash=(s:string)=>createHash('md5').update(s).digest('hex');
const micros=(v:string|null|undefined)=>v==null?null:String(Date.parse(v)*1000);
const canonical=(values:unknown[])=>'['+values.map(v=>JSON.stringify(v)).join(', ')+']';
export const OBSERVATION_CANONICAL_SQL=`jsonb_build_array(l.video_id,l.source,l.operation,
 ((extract(epoch from l.at)*1000000)::bigint)::text,l.views::text,l.time_basis,
 ((extract(epoch from l.received_at)*1000000)::bigint)::text,l.model_eligible,l.conflicted)::text`;
export const OBS_CHANGE_REFERENCES_SQL=`/* trace:observation.delta-references */
 with claims as (select * from jsonb_to_recordset($1::jsonb) as x(video_id text,generation bigint,last_change_id bigint))
 select l.change_id::text,md5(${OBSERVATION_CANONICAL_SQL}) as version
 from observation_change_log l join claims c using(video_id)
 where l.change_id>c.last_change_id and l.change_id<=c.generation order by l.change_id limit $2`;
export const OBS_CHANGE_BODIES_SQL=`/* trace:observation.delta-missing */
 select l.change_id::text,case when octet_length(${OBSERVATION_CANONICAL_SQL})<=4096
 then ${OBSERVATION_CANONICAL_SQL} else null end as body
 from observation_change_log l where l.change_id=any($1::bigint[])`;

export const OBS_CHANGES_FOR_CLAIMS_SQL = `
  /* trace:observation.delta-read */
  with claims as (
    select * from jsonb_to_recordset($1::jsonb)
      as x(video_id text, generation bigint, last_change_id bigint)
  )
  select l.change_id::text, l.video_id, l.source, l.operation, l.at, l.views,
         l.time_basis, l.received_at, l.model_eligible, l.conflicted
    from observation_change_log l join claims c using(video_id)
   where l.change_id > c.last_change_id and l.change_id <= c.generation
   order by l.change_id
   limit $2`;

export class ObservationCandidates {
 private db:DatabaseSync;
 hits=0;misses=0;rawFallbackRows=0;
 constructor(file:string){
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});this.db=new DatabaseSync(file);
  this.db.exec(`pragma busy_timeout=500;pragma journal_mode=WAL;
   create table if not exists candidates(version text primary key,body text not null,created_at integer not null) without rowid;
   create index if not exists candidates_age on candidates(created_at)`);
 }
 get(version:string,countStats=true):string|null{
  const r=this.db.prepare('select body from candidates where version=?').get(version);
  if(!r||hash(String(r.body))!==version){if(countStats)this.misses++;return null;}if(countStats)this.hits++;return String(r.body);
 }
 putRss(rows:readonly {video_id:string;at:string;views:number|string|null;time_basis?:string|null;received_at?:string|null;model_eligible?:boolean}[]):void{
  // SQL can withhold a candidate older than its API anchor. Keep both eligibility versions;
  // only the exact server fingerprint can select one. Conflicts use the authoritative fallback.
  const bodies=rows.flatMap(r=>[...new Set([r.model_eligible??true,false])].map(eligible=>canonical([
   r.video_id,'rss','upsert',micros(r.at),r.views==null?null:String(r.views),r.time_basis??null,
   micros(r.received_at),eligible,false,
  ])));
  this.putBodies(bodies);
 }
 putApi(rows:readonly {videoId:string;sampledAt:Date;views:number|string}[]):void{
  const bodies=rows.flatMap(r=>{
   const sample=micros(r.sampledAt.toISOString());
   // Snapshot write uses the UTC date string; a non-UTC database noon is safely a miss.
   const snapshot=micros(r.sampledAt.toISOString().slice(0,10)+'T12:00:00.000Z');
   return [canonical([r.videoId,'sample','upsert',sample,String(r.views),null,null,true,false]),
    canonical([r.videoId,'snapshot','upsert',snapshot,String(r.views),null,null,true,false]),
    canonical([r.videoId,'snapshot','delete',snapshot,null,null,null,true,false])];
  });
  this.putBodies(bodies);
 }
 private putBodies(bodies:string[]):void{
  this.db.exec('begin immediate');
  try{
   this.db.prepare('delete from candidates where version in(select version from candidates where created_at<? order by created_at limit 10000)').run(Date.now()-2*86400000);
   const count=Number(this.db.prepare('select count(*) n from candidates').get()!.n);
   if(count+bodies.length>1_000_000)this.db.prepare('delete from candidates where version in(select version from candidates order by created_at limit ?)').run(count+bodies.length-1_000_000);
   const put=this.db.prepare('insert into candidates values(?,?,?) on conflict(version) do update set body=excluded.body,created_at=excluded.created_at');
   for(const body of bodies){if(body.length<=4096)put.run(hash(body),body,Date.now());}
   this.db.exec('commit');
  }catch(e){this.db.exec('rollback');throw e;}
 }
 close():void{this.db.close();}
}
export function observationCandidatesPath():string{
 const u=new URL(process.env.DATABASE_URL!);const identity=JSON.stringify([u.hostname,u.pathname,u.username]);
 return path.join(process.cwd(),'.cache','observation-candidates',hash(identity)+'.sqlite');
}
let producerStore:ObservationCandidates|undefined;
/** Optional post-commit hint. Failure can never change ingestion's result or trigger rollback. */
export function rememberCommittedRssCandidates(rows:Parameters<ObservationCandidates['putRss']>[0]):void{
 if(process.env.EGRESS_JOB!=='rss-poll')return;
 try{
  if(!producerStore){producerStore=new ObservationCandidates(observationCandidatesPath());process.once('exit',()=>producerStore?.close());}
  producerStore.putRss(rows);
 }catch(e){console.warn(`observation candidate cache unavailable: ${(e as Error).message}`);}
}

/** Called only after the launch tracker transaction commits; no source read is added. */
export function rememberCommittedApiCandidates(rows:Parameters<ObservationCandidates['putApi']>[0]):void{
 try{
  if(!producerStore){producerStore=new ObservationCandidates(observationCandidatesPath());process.once('exit',()=>producerStore?.close());}
  producerStore.putApi(rows);
 }catch(e){console.warn(`observation candidate cache unavailable: ${(e as Error).message}`);}
}

export async function loadVerifiedObservationChanges(
 client:{query:(sql:string,values:any[])=>Promise<{rows:any[]}>},claims:string,limit:number,store:ObservationCandidates,
):Promise<any[]>{
 if(!Number.isSafeInteger(limit)||limit<1||limit>50001)throw Error('invalid observation delta budget');
 // A tiny representative prefix prevents a cold cache from doubling every row's transfer.
 // Reuse is worthwhile only at a high hit rate; direct reads remain byte-bounded.
 const probe=(await client.query(OBS_CHANGE_REFERENCES_SQL,[claims,Math.min(limit,16)])).rows;
 if(!probe.length)return [];
 let probeHits=0;
 for(const r of probe){try{if(store.get(r.version,false))probeHits++;}catch{/* optional cache */}}
 if(probeHits/probe.length<0.8){
  const raw=(await client.query(OBS_CHANGES_FOR_CLAIMS_SQL,[claims,limit])).rows;
  store.rawFallbackRows+=raw.length;return raw;
 }
 const refs=probe.length<Math.min(limit,16)?probe:(await client.query(OBS_CHANGE_REFERENCES_SQL,[claims,limit])).rows;
 const bodies=new Map<string,string>();const missing:any[]=[];
 for(const r of refs){let held:string|null=null;try{held=store.get(r.version);}catch{/* optional cache */}
  if(held)bodies.set(r.change_id,held);else missing.push(r);}
 for(let i=0;i<missing.length;i+=1000){
  const part=missing.slice(i,i+1000),versions=new Map(part.map(r=>[r.change_id,r.version]));
  for(const r of (await client.query(OBS_CHANGE_BODIES_SQL,[part.map(r=>r.change_id)])).rows){
   if(typeof r.body!=='string'||hash(r.body)!==versions.get(r.change_id))throw Error('observation delta changed during verified read');
   bodies.set(r.change_id,r.body);
  }
 }
 return refs.map(r=>{
  const body=bodies.get(r.change_id);if(!body)throw Error('observation delta disappeared during verified read');
  const a=JSON.parse(body);if(!Array.isArray(a)||a.length!==9)throw Error('invalid observation delta body');
  return {change_id:r.change_id,video_id:a[0],source:a[1],operation:a[2],at:new Date(Number(a[3])/1000),
   views:a[4],time_basis:a[5],received_at:a[6]===null?null:new Date(Number(a[6])/1000),model_eligible:a[7],conflicted:a[8]};
 });
}
