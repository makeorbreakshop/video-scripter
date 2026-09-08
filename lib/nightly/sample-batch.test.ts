import { writeSampleBatch, SampleWrite } from './sample-batch';
const rows: SampleWrite[] = Array.from({length:50},(_,i)=>({
 videoId:`video-${String(i).padStart(3,'0')}`,sampledAt:new Date('2026-09-04T21:00:00Z'),views:100+i,likes:2,comments:1,
 daysSincePublished:2,phase:'fixed',nextCheck:new Date('2026-09-04T22:00:00Z'),
 priorNextCheck:'2026-09-04 20:00:00.123456+00',priorUpdatedAt:'2026-09-04 19:00:00.654321+00',
}));
// Three set writes (view_samples, view_snapshots, track_schedule) plus the series_dirty mark,
// which is savepoint + insert + release: a failed mark must not abort the transaction that is
// about to commit the readings (lib/readings/series-store.ts markSeriesDirty). Six is a
// CONSTANT -- if it ever grows with the batch size, something has started writing per video.
test('persists a 50-video API batch in a constant number of database round trips',async()=>{
 const query=jest.fn(async()=>({rowCount:50}));
 await writeSampleBatch({query},rows);
 expect(query.mock.calls.length).toBeLessThanOrEqual(6);
 const bigger=Array.from({length:200},(_,i)=>({...rows[0],videoId:`v-${i}`}));
 const query2=jest.fn(async()=>({rowCount:200}));
 await writeSampleBatch({query:query2},bigger as any);
 expect(query2.mock.calls.length).toBe(query.mock.calls.length);
});
test('marks every video in the batch dirty in one statement',async()=>{
 const query=jest.fn(async()=>({rowCount:50}));
 await writeSampleBatch({query},rows);
 const marks=query.mock.calls.filter((c:any[])=>String(c[0]).includes('insert into series_dirty'));
 expect(marks).toHaveLength(1);
 expect(marks[0][1][0]).toHaveLength(50);
});
test('empty response does no sample writes',async()=>{
 const query=jest.fn(async()=>({rowCount:0}));
 expect(await writeSampleBatch({query},[])).toBe(0);expect(query).not.toHaveBeenCalled();
});
