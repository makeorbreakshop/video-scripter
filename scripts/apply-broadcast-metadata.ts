// Apply one inspected videos.list response to existing videos.metadata. Dry-run by default.
// Usage: npx tsx scripts/apply-broadcast-metadata.ts --file <captured-json> [--write]
// Never changes publication dates, view counts, samples, score rows or scheduling.
import fs from 'node:fs';
import {broadcastMetadataWrite} from '../lib/ingest/first-sample';
async function main(){
 const at=process.argv.indexOf('--file');
 if(at<0||!process.argv[at+1])throw new Error('Provide --file <captured-json>');
 const item=JSON.parse(fs.readFileSync(process.argv[at+1],'utf8'));
 if(!/^[A-Za-z0-9_-]{11}$/.test(item.id??''))throw new Error('Expected one YouTube video response');
 const write=broadcastMetadataWrite(item);
 if(!write)throw new Error('Response has no broadcast metadata');
 if(!process.argv.includes('--write')){
  console.log(JSON.stringify({mode:'dry-run',videoId:item.id,metadata:JSON.parse(write.params[2]),changes:['videos.metadata broadcast fields only']},null,2));return;
 }
 // Credentials/DB dependencies are loaded only in explicit write mode.
 const {config}=await import('dotenv');config({path:'.env.local'});
 const {Pool}=await import('pg');const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,statement_timeout:10000});
 try{const result=await pool.query(write.sql,write.params);console.log(JSON.stringify({mode:'write',videoId:item.id,updated:result.rowCount}));}
 finally{await pool.end();}
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Metadata apply failed');process.exitCode=1;});
