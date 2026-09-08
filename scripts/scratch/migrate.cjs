require('dotenv').config({path:'.env.local'});
const {Client}=require('pg');const fs=require('fs');
(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL,statement_timeout:60000});await c.connect();
for(const f of process.argv.slice(2)){await c.query(fs.readFileSync(f,'utf8'));console.log('applied',f);}
await c.end()})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
