import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';

export interface ExportMirrorSpec {
  name:string;
  /** Trusted source-code SQL only; scope values are parameters. */
  from:string; key:string; keyType:'text'|'uuid'; projection:string; scope?:string;
}
interface Change {key:string;hash:string;body:string}
interface Delta {row_count:number;payload_bytes:number;changes:Change[]|null;deleted:string[]}
/** Walk unique source keys using the database's own collation and index. */
export function mirrorKeysSql(spec:ExportMirrorSpec):string {
  return `SELECT ${spec.key}::text AS key FROM ${spec.from}
    WHERE ($1::${spec.keyType} IS NULL OR ${spec.key}>$1::${spec.keyType})
    ${spec.scope?`AND (${spec.scope.replaceAll('$6','$3')})`:''}
    ORDER BY ${spec.key} LIMIT $2`;
}
/** Send held fingerprints upstream; only changed projections come back. */
export function mirrorPageSql(spec:ExportMirrorSpec):string {
  return `WITH requested AS (SELECT unnest($1::${spec.keyType}[]) AS id),
    bodies AS MATERIALIZED (
      SELECT _mirror_key AS key,(to_jsonb(p)-'_mirror_key')::text AS body
      FROM (SELECT ${spec.key}::text AS _mirror_key,${spec.projection} FROM ${spec.from}
        WHERE ${spec.key}=ANY($1::${spec.keyType}[]) ${spec.scope?`AND (${spec.scope.replaceAll('$6','$4')})`:''}) p
    ), held AS (SELECT key,value AS hash FROM jsonb_each_text($2::jsonb)),
    delta AS MATERIALIZED (
      SELECT b.key,md5(b.body) AS hash,b.body FROM bodies b LEFT JOIN held h USING(key)
      WHERE h.hash IS DISTINCT FROM md5(b.body)
    ), stats AS (SELECT (SELECT count(*)::int FROM bodies) AS row_count,
      coalesce((SELECT sum(octet_length(body)) FROM delta),0)::float8 AS payload_bytes)
    SELECT stats.*,
      CASE WHEN payload_bytes <= $3 THEN coalesce((SELECT json_agg(delta) FROM delta),'[]'::json) ELSE NULL END AS changes,
      coalesce((SELECT json_agg(r.id::text) FROM requested r WHERE NOT EXISTS(SELECT 1 FROM bodies b WHERE b.key=r.id::text)),'[]'::json) AS deleted
    FROM stats`;
}
export class ExportRowMirror {
  private db:DatabaseSync;
  constructor(file:string){
    this.db=new DatabaseSync(file);
    this.db.exec(`PRAGMA busy_timeout=1000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS rows(key TEXT PRIMARY KEY,hash TEXT NOT NULL,body TEXT NOT NULL,seen INTEGER NOT NULL) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL) WITHOUT ROWID;`);
  }
  bind(identity:string):void{
    const r=this.db.prepare("SELECT value FROM metadata WHERE key='identity'").get() as {value:string}|undefined;
    if(r&&r.value!==identity)throw new Error('export mirror identity changed; use a new cache path');
    this.db.prepare("INSERT OR IGNORE INTO metadata VALUES('identity',?)").run(identity);
  }
  beginScan():void{this.db.exec('UPDATE rows SET seen=0');}
  held(keys:string[]):Record<string,string>{
    const result:Record<string,string>={};const get=this.db.prepare('SELECT hash,body FROM rows WHERE key=?');
    for(const key of keys){
      const row=get.get(key);
      // Only offer a fingerprint for bytes we actually hold. A corrupt cache is a miss.
      if(row && createHash('md5').update(String(row.body)).digest('hex')===row.hash)result[key]=String(row.hash);
    }
    return result;
  }
  apply(keys:string[],page:Delta,receipt?:{checkpoint:string;previous:string}):void{
    if(!Array.isArray(page.changes))throw new Error('export mirror response exceeded byte budget');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      let count=Number(this.metadata('expected-count')??this.count());
      const exists=this.db.prepare('SELECT 1 FROM rows WHERE key=?');
      const put=this.db.prepare('INSERT INTO rows VALUES(?,?,?,1) ON CONFLICT(key) DO UPDATE SET hash=excluded.hash,body=excluded.body,seen=1');
      const seen=this.db.prepare('UPDATE rows SET seen=1 WHERE key=?');
      const del=this.db.prepare('DELETE FROM rows WHERE key=?');
      for(const key of keys)seen.run(key);
      for(const key of page.deleted)count-=Number(del.run(key).changes);
      for(const r of page.changes){if(!/^[a-f0-9]{32}$/.test(r.hash))throw new Error('invalid projection fingerprint');JSON.parse(r.body);if(!exists.get(r.key))count++;put.run(r.key,r.hash,r.body);}
      this.setMetadata('expected-count',String(count));
      if(receipt){this.setMetadata('checkpoint',receipt.checkpoint);this.setMetadata('previous-checkpoint',receipt.previous);}
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  finishScan():void{
    this.db.exec('BEGIN IMMEDIATE');
    try{this.db.exec('DELETE FROM rows WHERE seen=0');this.setMetadata('expected-count',String(this.count()));this.db.exec('COMMIT');}
    catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  admit(epoch:string,checkpoint:string,previous:string):void{
    this.db.exec('BEGIN IMMEDIATE');
    try{this.setMetadata('capture-epoch',epoch);this.setMetadata('checkpoint',checkpoint);this.setMetadata('previous-checkpoint',previous);this.setMetadata('expected-count',String(this.count()));this.db.exec('COMMIT');}
    catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  *rows(keys?:readonly string[]):Generator<Record<string,unknown>>{
    if(keys){
      const get=this.db.prepare('SELECT body FROM rows WHERE key=?');
      for(const key of keys){const row=get.get(key);if(row)yield JSON.parse(String(row.body));}
    }else for(const row of this.db.prepare('SELECT body FROM rows ORDER BY key').iterate())yield JSON.parse(String(row.body));
  }
  /** Optional selected-input caches may evict unselected facts before a pass. */
  retainKeys(keys:readonly string[]):void{
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.exec('CREATE TEMP TABLE IF NOT EXISTS retained_keys(key TEXT PRIMARY KEY) WITHOUT ROWID; DELETE FROM retained_keys;');
      const put=this.db.prepare('INSERT OR IGNORE INTO retained_keys VALUES(?)');for(const key of keys)put.run(key);
      this.db.exec('DELETE FROM rows WHERE key NOT IN(SELECT key FROM retained_keys)');
      this.setMetadata('expected-count',String(this.count()));this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  bodyBytes(keys?:readonly string[]):number{
    if(!keys)return Number(this.db.prepare('SELECT coalesce(sum(length(cast(body AS blob))),0) AS n FROM rows').get()!.n);
    const get=this.db.prepare('SELECT length(cast(body AS blob)) AS n FROM rows WHERE key=?');
    return keys.reduce((n,key)=>n+Number(get.get(key)?.n??0),0);
  }
  count():number{return Number(this.db.prepare('SELECT count(*) AS n FROM rows').get()!.n);}
  metadata(key:string):string|undefined{const row=this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key);return row?String(row.value):undefined;}
  setMetadata(key:string,value:string):void{this.db.prepare('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);}
  corruptKeys(limit:number):string[]{
    const bad:string[]=[];
    for(const row of this.db.prepare('SELECT key,hash,body FROM rows').iterate()){
      if(createHash('md5').update(String(row.body)).digest('hex')!==row.hash){bad.push(String(row.key));if(bad.length>limit)throw Error('mirror corruption repair exceeds row budget');}
    }
    return bad;
  }
  close():void{this.db.close();}
}
export async function syncExportMirror(
 mirror:ExportRowMirror,spec:ExportMirrorSpec,
 query:(sql:string,values:unknown[])=>Promise<{rows:any[]}>,
 options:{batch:number;maxRows:number;maxBytes:number;scopeValue?:string;onPage?:(stats:{rows:number;changed:number;bytes:number})=>void},
):Promise<{rows:number;changed:number;bytes:number}>{
 if(![options.batch,options.maxRows,options.maxBytes].every(n=>Number.isSafeInteger(n)&&n>0))throw new Error('finite positive export budgets required');
 const stats={rows:0,changed:0,bytes:0};let cursor:string|null=null;let keysChecked=0;
 mirror.beginScan();
 for(;;){
  const keys:string[]=(await query(mirrorKeysSql(spec),[cursor,options.batch,...(spec.scope?[options.scopeValue]:[])])).rows.map(r=>String(r.key));
  if(!keys.length)break;
  keysChecked+=keys.length;
  if(keysChecked>options.maxRows)throw new Error('export mirror row budget exhausted');
  const page=(await query(mirrorPageSql(spec),[keys,mirror.held(keys),Math.min(16_000_000,options.maxBytes-stats.bytes),...(spec.scope?[options.scopeValue]:[])])).rows[0] as Delta;
  if(!page||!Array.isArray(page.changes))throw new Error('export response exceeded byte budget');
  stats.rows+=page.row_count;stats.changed+=page.changes.length;stats.bytes+=page.payload_bytes;
  if(stats.bytes>options.maxBytes)throw new Error('export mirror byte budget exhausted');
  mirror.apply(keys,page);options.onPage?.(stats);
  const next:string=keys.at(-1)!;if(next===cursor)throw new Error('export cursor did not advance');cursor=next;
 }
 mirror.finishScan();return stats;
}


/** A single durable consumer per dataset. Never advance a sequence high-water mark:
 * a lower sequence may commit later. Applied local rows precede exact-generation ACK.
 * The key cursor bounds a pass through continuously arriving work; later marks remain
 * queued for the next pass. Full exports are still assembled from the complete mirror.
 */
export async function syncIncrementalMirror(
 mirror:ExportRowMirror,spec:ExportMirrorSpec,
 query:(sql:string,values:unknown[])=>Promise<{rows:any[]}>,
 options:{batch:number;maxRows:number;maxBytes:number;owner:string;scopeValue?:string;
   bootstrap?:()=>Promise<{rows:number;changed:number;bytes:number}>;
   onPage?:(stats:{rows:number;changed:number;bytes:number})=>void},
):Promise<{rows:number;changed:number;bytes:number}>{
 if(![options.batch,options.maxRows,options.maxBytes].every(n=>Number.isSafeInteger(n)&&n>0)||!options.owner)throw Error('finite incremental mirror budgets and owner required');
 const reg=(await query(`/* trace:mirror.owner */
  UPDATE mirror_registry SET owner=$2 WHERE dataset=$1 AND (owner IS NULL OR owner=$2) RETURNING epoch,coalesce(checkpoint,'') AS checkpoint`,[spec.name,options.owner])).rows[0];
 if(!reg)throw Error('mirror dataset missing or owned by another owner');
 const stats={rows:0,changed:0,bytes:0};
 let checkpoint=String(reg.checkpoint);
 const acknowledge=async(next:string,claims:unknown[]=[])=>{
  const result=await query(`/* trace:mirror.ack */
   WITH receipt AS (
    UPDATE mirror_registry SET checkpoint=$4 WHERE dataset=$1 AND owner=$3 AND epoch=$6
      AND coalesce(checkpoint,'')=$5 RETURNING dataset
   ), removed AS (
    DELETE FROM mirror_dirty d USING jsonb_to_recordset($2::jsonb) x(key text,generation bigint),receipt r
    WHERE d.dataset=r.dataset AND d.key=x.key AND d.generation=x.generation RETURNING 1
   ) SELECT dataset FROM receipt`,[spec.name,JSON.stringify(claims),options.owner,next,checkpoint,reg.epoch]);
  if(result.rows.length!==1)throw Error('mirror checkpoint changed concurrently; retry under the job lease');
  checkpoint=next;
 };
 if(mirror.metadata('capture-epoch')!==reg.epoch){
  const boot=options.bootstrap?await options.bootstrap():await syncExportMirror(mirror,spec,query,options);
  Object.assign(stats,boot);const next=randomUUID();mirror.admit(reg.epoch,next,checkpoint);await acknowledge(next);
 }else{
  if(mirror.metadata('expected-count')!==String(mirror.count()))throw Error('mirror completeness mismatch; explicit bounded rebuild required');
  const local=mirror.metadata('checkpoint');
  if(local!==checkpoint){
   // A crash after local COMMIT but before server ACK is replayable. A restored older
   // file cannot match this predecessor and must never be published as current.
   if(!local||mirror.metadata('previous-checkpoint')!==checkpoint)throw Error('mirror checkpoint mismatch; explicit bounded rebuild required');
   await acknowledge(local);
  }
 }
 let consumed=0;
 const apply=async(keys:string[],claims:unknown[]=[])=>{
  consumed+=keys.length;if(consumed>options.maxRows)throw Error('incremental mirror row budget exhausted');
  const page=(await query(mirrorPageSql(spec),[keys,mirror.held(keys),Math.min(16_000_000,options.maxBytes-stats.bytes),...(spec.scope?[options.scopeValue]:[])])).rows[0] as Delta;
  if(!page||!Array.isArray(page.changes))throw Error('incremental mirror response exceeded byte budget');
  stats.bytes+=Number(page.payload_bytes);stats.changed+=page.changes.length;
  if(stats.bytes>options.maxBytes)throw Error('incremental mirror byte budget exhausted');
  const next=randomUUID();mirror.apply(keys,page,{checkpoint:next,previous:checkpoint});await acknowledge(next,claims);
 };
 const corrupt=mirror.corruptKeys(options.maxRows);
 for(let i=0;i<corrupt.length;i+=options.batch)await apply(corrupt.slice(i,i+options.batch));
 let cursor='';
 for(;;){
  const claims=(await query(`/* trace:mirror.claim */
   WITH picked AS MATERIALIZED (
    SELECT key FROM mirror_dirty WHERE dataset=$1 AND key>$2 ORDER BY key LIMIT $3 FOR UPDATE SKIP LOCKED
   ) UPDATE mirror_dirty d SET claimed=true FROM picked p
     WHERE d.dataset=$1 AND d.key=p.key RETURNING d.key,d.generation::text`,[spec.name,cursor,options.batch])).rows;
  if(!claims.length)break;
  const keys=claims.map(r=>String(r.key));await apply(keys,claims);
  // PostgreSQL owns collation/order, not JS string comparison.
  cursor=(await query(`SELECT max(key) AS key FROM unnest($1::text[]) k(key)`,[keys])).rows[0].key;
  stats.rows=mirror.count();options.onPage?.({...stats});
 }
 stats.rows=mirror.count();if(stats.rows>options.maxRows)throw Error('incremental mirror corpus row budget exhausted');
 return stats;
}
