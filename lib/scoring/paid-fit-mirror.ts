import {DAY_BUCKETS,growthExponent,type FitRow,type Snapshot} from './core';
import type {QueryFn} from './prior-load';
import {mirrorPageSql,type ExportRowMirror,type ExportMirrorSpec} from '../readings/export-row-mirror';
import {chunk} from '../nightly/tracking-core';
const tolerance=(b:number)=>b<=3?1:b<=7?2:3;
const GROWTH_EPSILON_MICROS=Math.ceil(1e-9*86400*1e6);
export const PAID_FIT_MAX_DAY=Math.max(...DAY_BUCKETS.filter(b=>b<30).map(b=>b+tolerance(b)));
// A FitRow only consumes records through its selected pre30 reading. Cache precisely that
// source window; retain the original query for unspecified different-value SQL ties.
export const PAID_FIT_SPEC:ExportMirrorSpec={
 name:'paid-fit',key:'v.id',keyType:'text',
 from:`videos v cross join lateral (
   with points as materialized (
     select s.snapshot_date::timestamptz+interval '12 hours' as at,s.view_count as views
       from view_snapshots s where s.video_id=v.id and s.view_count>0
         and s.snapshot_date::timestamptz+interval '12 hours' between v.published_at and v.published_at+interval '${PAID_FIT_MAX_DAY} days'+interval '${GROWTH_EPSILON_MICROS} microseconds'
     union all
     select s.sampled_at,s.view_count from view_samples s where s.video_id=v.id and s.view_count>0
       and s.sampled_at between v.published_at and v.published_at+interval '${PAID_FIT_MAX_DAY} days'+interval '${GROWTH_EPSILON_MICROS} microseconds'
   ), truth as materialized (
     select s.view_count,s.days_since_published from view_snapshots s
       where s.video_id=v.id and s.days_since_published between 27 and 33 and s.view_count>0
   ), closest as materialized (
     select * from truth where abs(days_since_published-30)=(select min(abs(days_since_published-30)) from truth)
   ), ambiguity as (
     select exists(select 1 from points group by at having count(distinct views)>1)
       or (select count(distinct view_count)>1 from closest) as ambiguous
   )
   select ambiguous,
     (select view_count from closest limit 1) as v30,
     case when ambiguous then '[]'::json else coalesce((
       select json_agg(json_build_array(extract(epoch from(p.at-v.published_at))/86400.0,p.views) order by p.at) from points p
     ),'[]'::json) end as points from ambiguity
 ) facts`,projection:'v.id as video_id,facts.ambiguous,facts.v30,facts.points',
};
export const LEGACY_PAID_FIT_RECORDS_SQL=`select x.video_id,extract(epoch from(x.at-v.published_at))/86400.0 as day,x.views
 from (select video_id,snapshot_date::timestamptz+interval '12 hours' as at,view_count as views from view_snapshots where video_id=any($1)
 union all select video_id,sampled_at,view_count from view_samples where video_id=any($1)) x
 join videos v on v.id=x.video_id where x.views>0 and x.at>=v.published_at order by x.video_id,x.at limit $2`;
export const LEGACY_PAID_FIT_TRUTH_SQL=`select distinct on(video_id) video_id,view_count from view_snapshots
 where video_id=any($1) and days_since_published between 27 and 33 and view_count>0
 order by video_id,abs(days_since_published-30)`;
export async function loadPaidFitRows(q:QueryFn,mirror:ExportRowMirror,ids:string[],options:{maxBytes?:number;maxRows?:number;onPage?:(s:{videos:number;changed:number;bytes:number})=>void}={}):Promise<FitRow[]>{
 const maxBytes=options.maxBytes??100_000_000,maxRows=options.maxRows??5_000_000;
 if(![maxBytes,maxRows].every(n=>Number.isSafeInteger(n)&&n>0)||maxBytes>100_000_000||maxRows>5_000_000||ids.length>60000)throw Error('invalid paid-fit budget');
 const output:FitRow[]=[];const stats={videos:0,changed:0,bytes:0};let sourceRows=0;
 mirror.retainKeys(ids);
 let heldBytes=mirror.bodyBytes();
 mirror.beginScan();
 for(const part of chunk(ids,500)){
  const page=(await q(mirrorPageSql(PAID_FIT_SPEC),[part,mirror.held(part),Math.min(16_000_000,maxBytes-stats.bytes)]))[0];
  if(!page||!Array.isArray(page.changes))throw Error('paid-fit response exceeded byte budget');
  stats.bytes+=Number(page.payload_bytes);stats.changed+=page.changes.length;
  if(stats.bytes>maxBytes)throw Error('paid-fit byte budget exceeded');
  // Bound retained cache size as well as today's transfer. Optional cache eviction does
  // not discard source data; fail rather than accumulate an oversized local corpus.
  const replacedBytes=mirror.bodyBytes([...page.changes.map((r:any)=>String(r.key)),...page.deleted]);
  if(heldBytes-replacedBytes+Number(page.payload_bytes)>100_000_000)throw Error('paid-fit retained cache byte budget exceeded');
  mirror.apply(part,page);
  heldBytes=heldBytes-replacedBytes+Number(page.payload_bytes);
  const facts=new Map([...mirror.rows(part)].map(r=>[String(r.video_id),r]));
  const ambiguous=part.filter(id=>facts.get(id)?.ambiguous);const legacy=new Map<string,Snapshot[]>();let truth=new Map<string,number>();
  if(ambiguous.length){
   const rows=await q(LEGACY_PAID_FIT_RECORDS_SQL,[ambiguous,50001]);
   const truths=await q(LEGACY_PAID_FIT_TRUTH_SQL,[ambiguous]);
   stats.bytes+=Buffer.byteLength(JSON.stringify(rows))+Buffer.byteLength(JSON.stringify(truths));
   if(rows.length>50000||stats.bytes>maxBytes)throw Error('ambiguous paid-fit fallback budget exceeded');
   for(const r of rows){if(!legacy.has(r.video_id))legacy.set(r.video_id,[]);legacy.get(r.video_id)!.push({day:Number(r.day),views:Number(r.views)});}
   truth=new Map(truths.map(r=>[String(r.video_id),Number(r.view_count)]));
  }
  for(const id of part){
   const f=facts.get(id);if(!f)continue;
   const v30=f.ambiguous?truth.get(id):Number(f.v30);if(!v30)continue;
   if(!Array.isArray(f.points))throw Error('invalid paid-fit cached points');
   const snaps:Snapshot[]=f.ambiguous?(legacy.get(id)??[]):f.points.map((p:any)=>({day:Number(p[0]),views:Number(p[1])}));
   sourceRows+=snaps.length;if(sourceRows>maxRows)throw Error('paid-fit row budget exceeded');
   for(const b of DAY_BUCKETS){if(b>=30)continue;
    const near=snaps.filter(s=>Math.abs(s.day-b)<=tolerance(b)).sort((p,q)=>Math.abs(p.day-b)-Math.abs(q.day-b))[0];
    if(near)output.push({bucket:b,vt:near.views,v30,q:growthExponent(snaps.filter(s=>s.day<=near.day+1e-9))});
   }
  }
  stats.videos+=part.length;options.onPage?.({...stats});
 }
 mirror.finishScan();return output;
}
