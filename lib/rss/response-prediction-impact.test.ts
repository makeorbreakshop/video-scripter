// Fixed-input diagnostics, not a forecast-accuracy benchmark or a production fit.
import { scoreV5 } from '../scoring/curve';
import type { GlobalParams } from '../scoring/core';
import { mergeObservations } from '../scoring/observations';
import { decideSamplingSource } from '../nightly/sampling-freshness';
const params:GlobalParams={mult:{1:1,2:0.7,3:0.5,30:0},qBins:{3:{edges:[3.2],resid:[-0.1,0.1]}},fittedAt:'2026-09-01T00:00:00Z',nVideos:100};
const priors=[10,20,30].map(ageDays=>({ageDays,samples:[{day:3,views:500}]}));
const published='2026-09-01T00:00:00Z';
const api=[{at:'2026-09-02T00:00:00Z',views:100},{at:'2026-09-04T00:00:00Z',views:1000}];
const run=(rss:{at:string;views:number}[])=>{
  const snaps=mergeObservations(published,[],api,rss,Date.parse('2026-09-04T01:00:00Z'));
  const latest=snaps.at(-1)!;
  return {latest,result:scoreV5({vt:latest.views,age:latest.day,snaps,priors,params})};
};
test('an interior older RSS point leaves latest API anchor, score, growth exponent and projection unchanged',()=>{
  expect(run([{at:'2026-09-03T00:00:00Z',views:400}])).toEqual(run([]));
});
test('extending the earliest history can change the projection even when latest API and same-age score stay unchanged',()=>{
  const before=run([]),after=run([{at:'2026-09-01T12:00:00Z',views:50}]);
  expect(after.latest).toEqual(before.latest);
  expect(after.result.score).toBe(before.result.score);
  expect(after.result.q).not.toBe(before.result.q);
  expect(after.result.projection).not.toBe(before.result.projection);
});
const now=new Date('2026-09-07T12:00:00Z');
const candidate={intervalMinutes:15,lastViews:100,lastApiAt:new Date('2026-09-07T11:50:00Z'),rssAt:new Date('2026-09-07T11:58:00Z'),rssViews:100};
test('five-minute launch bursts use API even when RSS appears fresh',()=>{
  expect(decideSamplingSource({...candidate,intervalMinutes:5},now)).toEqual({source:'api',reason:'burst'});
});
test('routine source selection must use the response clock: fetched-newer can actually be older than API',()=>{
  expect(decideSamplingSource(candidate,now)).toEqual({source:'rss',reason:'fresh_rss'});
  expect(decideSamplingSource({...candidate,rssAt:new Date('2026-09-07T11:48:00Z')},now))
    .toEqual({source:'api',reason:'rss_not_newer'});
});
