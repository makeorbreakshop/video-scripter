import { writeSampleBatch, SampleWrite } from './sample-batch';
const rows: SampleWrite[] = Array.from({length:50},(_,i)=>({
 videoId:`video-${String(i).padStart(3,'0')}`,sampledAt:new Date('2026-09-04T21:00:00Z'),views:100+i,likes:2,comments:1,
 daysSincePublished:2,phase:'fixed',nextCheck:new Date('2026-09-04T22:00:00Z'),
 priorNextCheck:'2026-09-04 20:00:00.123456+00',priorUpdatedAt:'2026-09-04 19:00:00.654321+00',
}));
test('persists a 50-video API batch with at most three database round trips',async()=>{
 const query=jest.fn(async()=>({rowCount:50}));
 await writeSampleBatch({query},rows);
 expect(query.mock.calls.length).toBeLessThanOrEqual(3);
});
test('empty response does no sample writes',async()=>{
 const query=jest.fn(async()=>({rowCount:0}));
 expect(await writeSampleBatch({query},[])).toBe(0);expect(query).not.toHaveBeenCalled();
});
