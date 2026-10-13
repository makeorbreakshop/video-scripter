import type { QueryFn } from './prior-load';
import { longformSql } from './longform';
import type { LaunchRow5 } from './growth';
import { syncIncrementalMirror, mirrorPageSql, type ExportRowMirror, type ExportMirrorSpec } from '../readings/export-row-mirror';
import { chunk } from '../nightly/tracking-core';

/** Original fit query, with a required finite video scope for parity and ambiguous ties. */
export const LEGACY_LAUNCH_ROWS_SQL = `with lf as (
 select v.id,v.published_at from videos v
 where v.published_at >= $1::date and ${longformSql('v')} and v.id=any($2::text[])),
 samp as (
 select s.video_id,extract(epoch from(s.sampled_at-lf.published_at))/3600.0 as hours,s.view_count
 from view_samples s join lf on lf.id=s.video_id where s.view_count>0),
 d1 as (
 select distinct on(video_id) video_id,view_count as v1 from (
 select video_id,hours,view_count from samp union all
 select s.video_id,extract(epoch from(s.snapshot_date::timestamptz+interval '12 hours'-lf.published_at))/3600.0,s.view_count
 from view_snapshots s join lf on lf.id=s.video_id where s.view_count>0
 ) o where hours between 21 and 27 order by video_id,abs(hours-24))
 select o.hours,o.view_count as vh,d1.v1 from samp o join d1 on d1.video_id=o.video_id
 where o.hours>0 and o.hours<20`;


// Enumerate the indexed publish window without evaluating eligibility over the whole table.
// The finite per-video body query applies the unchanged long-form rule.
export const LAUNCH_FIT_IDS_SQL = `select v.id from videos v
 where v.published_at >= $1::date
 order by v.published_at limit 1000001`;

// Each requested video uses indexed source probes. Day1 ties with different counts are
// deliberately left on the original SQL path, whose choice among ties was not specified.
export const LAUNCH_FIT_SPEC:ExportMirrorSpec = {
 name:'launch-fit',key:'v.id',keyType:'text',
 scope:`v.published_at >= $6::date and ${longformSql('v')}`,
 from:`videos v cross join lateral (
   with samp as materialized (
     select extract(epoch from(s.sampled_at-v.published_at))/3600.0 as hours,s.view_count
       from view_samples s where s.video_id=v.id and s.view_count>0
         and s.sampled_at > v.published_at and s.sampled_at <= v.published_at+interval '27 hours'
   ), candidates as materialized (
     select hours,view_count from samp where hours between 21 and 27
     union all
     select extract(epoch from(s.snapshot_date::timestamptz+interval '12 hours'-v.published_at))/3600.0,s.view_count
       from view_snapshots s where s.video_id=v.id and s.view_count>0
         and s.snapshot_date::timestamptz+interval '12 hours' between v.published_at+interval '21 hours' and v.published_at+interval '27 hours'
   ), closest as materialized (
     select * from candidates where abs(hours-24)=(select min(abs(hours-24)) from candidates)
   ), tie as (
     select count(distinct view_count)>1 as ambiguous from closest
   )
   select tie.ambiguous,
     case when tie.ambiguous then '[]'::json else coalesce((
       select json_agg(json_build_array(o.hours,o.view_count,d.v1) order by o.hours,o.view_count)
         from samp o cross join (select view_count as v1 from closest limit 1) d
        where o.hours>0 and o.hours<20
     ),'[]'::json) end as pairs from tie
 ) facts`,
 projection:'v.id as video_id,facts.ambiguous,facts.pairs',
};

export async function loadLaunchFitRows(
 q:QueryFn,mirror:ExportRowMirror,ids:string[],since:string,
 options:{maxBytes?:number;maxRows?:number;onPage?:(s:{videos:number;changed:number;bytes:number;rows:number})=>void}={},
):Promise<LaunchRow5[]> {
 const maxBytes=options.maxBytes??250_000_000,maxRows=options.maxRows??10_000_000;
 if(![maxBytes,maxRows].every(x=>Number.isSafeInteger(x)&&x>0)||maxBytes>250_000_000||maxRows>10_000_000)throw Error('invalid launch-fit budgets');
 const unique=[...new Set(ids)];if(unique.length>1000000)throw Error('launch-fit video budget exceeded');
 const out:LaunchRow5[]=[];const stats={videos:0,changed:0,bytes:0,rows:0};
 mirror.beginScan();
 for(const part of chunk(unique,500)){
   const page=(await q(mirrorPageSql(LAUNCH_FIT_SPEC),[part,mirror.held(part),Math.min(16_000_000,maxBytes-stats.bytes),since]))[0];
   if(!page||!Array.isArray(page.changes))throw Error('launch-fit response exceeded byte budget');
   stats.bytes+=Number(page.payload_bytes);stats.changed+=page.changes.length;stats.videos+=part.length;
   if(stats.bytes>maxBytes)throw Error('launch-fit byte budget exceeded');
   mirror.apply(part,page);
   const ambiguous:string[]=[];
   for(const row of mirror.rows(part)){
     if(row.ambiguous){ambiguous.push(String(row.video_id));continue;}
     if(!Array.isArray(row.pairs))throw Error('invalid launch-fit cached rows');
     for(const pair of row.pairs){out.push({hours:Number(pair[0]),vh:Number(pair[1]),v1:Number(pair[2])});if(out.length>maxRows)throw Error('launch-fit row budget exceeded');}
   }
   if(ambiguous.length){
     const rows=await q(LEGACY_LAUNCH_ROWS_SQL+' limit $3',[since,ambiguous,50001]);
     if(rows.length>50000)throw Error('ambiguous launch-fit fallback row budget exceeded');
     stats.bytes+=Buffer.byteLength(JSON.stringify(rows));
     if(stats.bytes>maxBytes||out.length+rows.length>maxRows)throw Error('launch-fit fallback budget exceeded');
     out.push(...rows.map(r=>({hours:Number(r.hours),vh:Number(r.vh),v1:Number(r.v1)})));
   }
   stats.rows=out.length;options.onPage?.({...stats});
 }
 mirror.finishScan();return out;
}

/** Complete local inputs plus only keys changed since the last committed synchronization. */
export async function loadIncrementalLaunchFitRows(
 q:QueryFn,mirror:ExportRowMirror,since:string,owner:string,
 options:{maxBytes?:number;maxRows?:number;onPage?:(s:{videos:number;changed:number;bytes:number;rows:number})=>void}={},
):Promise<LaunchRow5[]>{
 const maxBytes=options.maxBytes??250_000_000,maxRows=options.maxRows??10_000_000;
 if(![maxBytes,maxRows].every(n=>Number.isSafeInteger(n)&&n>0)||maxBytes>250_000_000||maxRows>10_000_000)throw Error('invalid launch-fit budgets');
 const stats=await syncIncrementalMirror(mirror,LAUNCH_FIT_SPEC,async(sql,values)=>({rows:await q(sql,values)}),{
  batch:500,maxRows:1_000_000,maxBytes,owner,scopeValue:since,
  bootstrap:async()=>{
   const ids=(await q(LAUNCH_FIT_IDS_SQL,[since])).map(r=>String(r.id));
   if(ids.length>1_000_000)throw Error('launch-fit video budget exceeded');
   let bytes=0,changed=0;
   await loadLaunchFitRows(q,mirror,ids,since,{maxBytes,maxRows,onPage:s=>{bytes=s.bytes;changed=s.changed;options.onPage?.(s);}});
   return {rows:mirror.count(),bytes,changed};
  },
 });
 const out:LaunchRow5[]=[],ambiguous:string[]=[];
 for(const row of mirror.rows()){
  if(row.ambiguous){ambiguous.push(String(row.video_id));continue;}
  if(!Array.isArray(row.pairs))throw Error('invalid launch-fit cached rows');
  for(const p of row.pairs){out.push({hours:Number(p[0]),vh:Number(p[1]),v1:Number(p[2])});if(out.length>maxRows)throw Error('launch-fit row budget exceeded');}
 }
 let bytes=stats.bytes;
 for(const ids of chunk(ambiguous,500)){
  const rows=await q(LEGACY_LAUNCH_ROWS_SQL+' limit $3',[since,ids,50001]);
  bytes+=Buffer.byteLength(JSON.stringify(rows));
  if(rows.length>50000||bytes>maxBytes||out.length+rows.length>maxRows)throw Error('ambiguous launch-fit fallback budget exceeded');
  out.push(...rows.map(r=>({hours:Number(r.hours),vh:Number(r.vh),v1:Number(r.v1)})));
 }
 options.onPage?.({videos:stats.rows,changed:stats.changed,bytes,rows:out.length});
 return out;
}
