import fixture from '../../docs/audits/2026-09-04-v5-chart-fixture.json';
import broadcast from '../../docs/audits/2026-09-04-andy-live-metadata.json';
import {loadVideoPage,headerLines} from './video-page';
import {videoPage} from '../admin/queries';
jest.mock('../admin/queries',()=>({videoPage:jest.fn()}));
const data:any=fixture;
const id=broadcast.id;
function scenario(details:unknown=broadcast.liveStreamingDetails,status='none'){
 const video={...data.videos.find((v:any)=>v.id===id),duration:broadcast.contentDetails.duration,
   metadata:{live_streaming_details:details,live_broadcast_content:status}};
 const own=(key:string)=>data[key].filter((s:any)=>s.video_id===id).map((s:any)=>({...s,views:Number(s.views)}));
 const snapshots=own('snapshots').map((s:any)=>({...s,at:`${s.snapshot_date.slice(0,10)}T12:00:00.000Z`}));
 return {video,snapshots,samples:own('samples'),rss:own('rss'),score:data.scores.find((s:any)=>s.video_id===id),thumbs:[],titles:[],mult:data.params.params.mult,longtail:data.params.params.longtail,bands:null};
}
test('reported archived stream starts its performance chart at actual broadcast time, preserving the first recorded zero after start',async()=>{
 jest.mocked(videoPage).mockResolvedValue(scenario());
 const v:any=await loadVideoPage(id,Date.parse(data.capturedAt));
 expect(v.chartOriginAt).toBe(broadcast.liveStreamingDetails.actualStartTime);
 expect(v.publishedAt).toBe('2026-09-01T16:23:51.000Z');
 expect(v.actuals[0].views).toBe(0);
 expect(v.actuals[0].day).toBeCloseTo((Date.parse('2026-09-03T15:59:37.659Z')-Date.parse(broadcast.liveStreamingDetails.actualStartTime))/86400000,9);
 expect(v.series[0].day).toBe(v.actuals[0].day);
 expect(v.series.every((p:any)=>p.kind==='measured')).toBe(true);
 expect(v.comparison).toBeNull();
 const h=headerLines(v);
 expect(h.big).toBeNull();
 expect(h.verdict).toBe('');
 expect(h.meta.timeLabel).toBe('Stream started');
 expect(h.meta.contextNote).toContain('Comparison and forecast');
 expect(h.verdict).not.toContain('0.8');
});
test('broadcast with unknown actual start does not infer a history or forecast from its publication date',async()=>{
 jest.mocked(videoPage).mockResolvedValue(scenario({},'upcoming'));
 const v:any=await loadVideoPage(id,Date.parse(data.capturedAt));
 expect(v.broadcastNotice).toContain('start time');
 expect(v.series.every((p:any)=>p.kind==='measured')).toBe(true);
 expect(v.series[0].day).toBe(v.actuals[0].day);
 expect(v.comparison).toBeNull();
});

test('unknown stream start preserves recorded views even when publication moved after them',async()=>{
 const row=scenario({},'none');row.video.published_at='2026-09-04T06:10:27Z';
 jest.mocked(videoPage).mockResolvedValue(row);
 const v:any=await loadVideoPage(id,Date.parse(data.capturedAt));
 expect(v.actuals.some((a:any)=>a.views===116)).toBe(true);
 expect(v.publishedAt).toBe('2026-09-04T06:10:27.000Z');
 expect(headerLines(v).meta.age).toBe('stream age unknown');
 expect(headerLines(v).meta.publishedMs).toBe(Date.parse(row.video.published_at));
});
