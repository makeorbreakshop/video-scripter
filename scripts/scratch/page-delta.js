require("dotenv").config({path:".env.local"});const pg=require("pg");const {execSync}=require("child_process");
const url=process.argv[2];const c=new pg.Client({connectionString:process.env.DATABASE_URL,statement_timeout:20000});
const snap=async()=>{const r=await c.query("select queryid, calls, total_exec_time t, shared_blks_read br, shared_blks_hit bh, left(regexp_replace(query,'\\s+',' ','g'),120) q from pg_stat_statements where userid=(select oid from pg_roles where rolname='postgres')");return new Map(r.rows.map(x=>[x.queryid,x]))};
(async()=>{await c.connect();const a=await snap();const t0=Date.now();
const code=execSync(`curl -s -o /dev/null -b "${process.argv[3]}" -w "%{http_code}" "${url}"`).toString();const wall=Date.now()-t0;
const b=await snap();const d=[];let sum=0;for(const [id,x] of b){const y=a.get(id);const dc=x.calls-(y?y.calls:0);if(dc<=0)continue;const dt=x.t-(y?y.t:0);sum+=dt;d.push({calls:dc,ms:Math.round(dt),blk_read:x.br-(y?y.br:0),hit:x.bh-(y?y.bh:0),q:x.q})}
d.sort((p,q)=>q.ms-p.ms);console.log(`== ${url} http ${code} wall ${wall}ms, db total ${Math.round(sum)}ms across ${d.length} distinct statements`);for(const x of d.slice(0,8))console.log(JSON.stringify(x));await c.end()})().catch(e=>console.error("ERR",e.message))
