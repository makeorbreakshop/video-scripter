import {ingestWrites,firstSampleWrite} from './first-sample';
import broadcast from '../../docs/audits/2026-09-04-andy-live-metadata.json';
test('import retains completed broadcast timing without overwriting the original publication clock',()=>{
 const writes=ingestWrites(broadcast,1,new Date(broadcast.retrievedAt));
 const metadata=writes.find(w=>/update videos/.test(w.sql));
 expect(metadata).toBeDefined();
 expect(metadata!.sql).not.toMatch(/published_at\s*=/);
 expect(JSON.stringify(metadata!.params)).toContain(broadcast.liveStreamingDetails.actualStartTime);
});
test('view samples keep cumulative views separate from concurrent viewers, including a valid zero',()=>{
 for(const viewCount of ['0','1873']){
  const w=firstSampleWrite({...broadcast,statistics:{viewCount},liveStreamingDetails:{concurrentViewers:'500'}},new Date(broadcast.retrievedAt));
  expect(w!.params[2]).toBe(Number(viewCount));
 }
});

test.each([[], 'bad', 7, true])('malformed live details do not relabel an ordinary video (%p)',details=>{
 const writes=ingestWrites({...broadcast,liveStreamingDetails:details},1,new Date(broadcast.retrievedAt));
 expect(writes.some(w=>/update videos/.test(w.sql))).toBe(false);
});
