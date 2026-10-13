import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

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
  apply(keys:string[],page:Delta):void{
    if(!Array.isArray(page.changes))throw new Error('export mirror response exceeded byte budget');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const put=this.db.prepare('INSERT INTO rows VALUES(?,?,?,1) ON CONFLICT(key) DO UPDATE SET hash=excluded.hash,body=excluded.body,seen=1');
      const seen=this.db.prepare('UPDATE rows SET seen=1 WHERE key=?');
      const del=this.db.prepare('DELETE FROM rows WHERE key=?');
      for(const key of keys)seen.run(key);
      for(const key of page.deleted)del.run(key);
      for(const r of page.changes){if(!/^[a-f0-9]{32}$/.test(r.hash))throw new Error('invalid projection fingerprint');JSON.parse(r.body);put.run(r.key,r.hash,r.body);}
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  finishScan():void{this.db.exec('DELETE FROM rows WHERE seen=0');}
  *rows(keys?:readonly string[]):Generator<Record<string,unknown>>{
    if(keys){
      const get=this.db.prepare('SELECT body FROM rows WHERE key=?');
      for(const key of keys){const row=get.get(key);if(row)yield JSON.parse(String(row.body));}
    }else for(const row of this.db.prepare('SELECT body FROM rows ORDER BY key').iterate())yield JSON.parse(String(row.body));
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
  const keys=(await query(mirrorKeysSql(spec),[cursor,options.batch,...(spec.scope?[options.scopeValue]:[])])).rows.map(r=>String(r.key));
  if(!keys.length)break;
  keysChecked+=keys.length;
  if(keysChecked>options.maxRows)throw new Error('export mirror row budget exhausted');
  const page=(await query(mirrorPageSql(spec),[keys,mirror.held(keys),Math.min(16_000_000,options.maxBytes-stats.bytes),...(spec.scope?[options.scopeValue]:[])])).rows[0] as Delta;
  if(!page||!Array.isArray(page.changes))throw new Error('export response exceeded byte budget');
  stats.rows+=page.row_count;stats.changed+=page.changes.length;stats.bytes+=page.payload_bytes;
  if(stats.bytes>options.maxBytes)throw new Error('export mirror byte budget exhausted');
  mirror.apply(keys,page);options.onPage?.(stats);
  const next=keys.at(-1)!;if(next===cursor)throw new Error('export cursor did not advance');cursor=next;
 }
 mirror.finishScan();return stats;
}
