import { advanceResponse, type FeedResponse } from './response-freshness';
import { decideSamplingSource } from '../nightly/sampling-freshness';
test('a newer fetch of older data cannot move the scheduler current response clock past the API',()=>{
  const fresh:FeedResponse={channelId:'c',fetchedAt:'2026-09-07T11:19:00Z',date:'Mon, 07 Sep 2026 11:18:00 GMT',age:null,cacheControl:null,views:{v:100}};
  let state=advanceResponse(null,fresh).state;
  state=advanceResponse(state,{...fresh,fetchedAt:'2026-09-07T11:25:00Z',date:'Mon, 07 Sep 2026 11:11:00 GMT',views:{v:90}}).state;
  expect(state.current?.date).toBe(fresh.date);
  expect(decideSamplingSource({intervalMinutes:15,lastViews:100,lastApiAt:new Date('2026-09-07T11:20:00Z'),rssViews:state.current!.views.v,rssAt:new Date(state.current!.date!)},new Date('2026-09-07T11:26:00Z')))
    .toEqual({source:'api',reason:'rss_not_newer'});
});
test('unknown headers cannot advance the scheduler clock',()=>{
  const response:FeedResponse={channelId:'c',fetchedAt:'2026-09-07T11:25:00Z',date:null,age:null,cacheControl:null,views:{v:100}};
  expect(advanceResponse(null,response).state.current).toBeNull();
});
