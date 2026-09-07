import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { archiveResponses } from './response-archive';
let root:string;
beforeEach(async()=>{root=await fs.mkdtemp(path.join(os.tmpdir(),'rss-archive-'));});
afterEach(async()=>{await fs.rm(root,{recursive:true,force:true});});
test('full XML and every receipt survive repeated response bodies and can be read back',async()=>{
  const receipts=[{xml:'<feed>full body</feed>',at:1,headers:{age:'10'}},{xml:'<feed>full body</feed>',at:2,headers:{age:'11'}}];
  const r=await archiveResponses(root,100,receipts);
  expect(gunzipSync(await fs.readFile(path.join(root,r.name))).toString().trim().split('\n').map(s=>JSON.parse(s))).toEqual(receipts);
});
test('retention and capacity remove only old archive segments and report expiration',async()=>{
  await archiveResponses(root,100,[{a:1}]);
  const r=await archiveResponses(root,200,[{a:2}],{ageMs:50,bytes:1000});
  expect(r.expired).toEqual(['100.jsonl.gz']);
  expect(await fs.readdir(root)).toEqual(['200.jsonl.gz']);
  const capped=await archiveResponses(root,300,[{a:3}],{ageMs:1000,bytes:1});
  expect(capped.expired).toEqual(['200.jsonl.gz']);
  expect(capped.overBudget).toBe(true); // newest receipt is never silently discarded
});
