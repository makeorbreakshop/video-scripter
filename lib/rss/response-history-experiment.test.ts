import fs from 'node:fs';
import path from 'node:path';
import { reconstructHistory, type RawReading } from '../../scripts/experiments/rss-response-history';
import { mergeActuals } from '../admin/video-curve';
import { buildSeries } from '../app/chart-series';
const raw: RawReading[] = JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/response-history-2026-09-07.json'),'utf8'));
const every = raw.filter(r=>r.videoId==='1EEw36H2zLo');
const pablo = raw.filter(r=>r.videoId==='YBvdMVY7LW4');

test('the captured delayed Every count fills earlier history instead of creating a new drop',()=>{
  const result=reconstructHistory(every);
  expect(result.history.map(r=>[new Date(r.at).toISOString(),r.views])).toEqual([
    ['2026-09-07T11:11:24.000Z',88653],
    ['2026-09-07T11:18:17.000Z',88694],
    ['2026-09-07T11:19:29.000Z',88694],
  ]);
  expect(result.history.every(r=>r.timeBasis==='response-date-estimate')).toBe(true);
  expect(result.audit).toEqual(every);
});
test('duplicate cached response retains both receipts but contributes one historical point',()=>{
  const result=reconstructHistory(every);
  const old=result.history.filter(r=>r.views===88653);
  expect(old).toHaveLength(1);
  expect(old[0].evidenceIds).toEqual(['round-2:1EEw36H2zLo','round-3:1EEw36H2zLo']);
  expect(result.audit).toHaveLength(4);
});
test('six-video replay retains all 24 receipts and preserves latest counts',()=>{
  const result=reconstructHistory(raw);
  expect(result.audit).toHaveLength(24);
  for(const id of new Set(raw.map(r=>r.videoId))){
    const history=result.history.filter(r=>r.videoId===id);
    expect(history.at(-1)!.views).toBe(raw.filter(r=>r.videoId===id).at(-1)!.views);
    expect(history.every((r,i)=>!i||r.at>=history[i-1].at)).toBe(true);
  }
});
test.each([['Every',every,'2026-09-03T19:24:06Z'],['Pablo',pablo,'2026-09-04T09:00:00Z']] as const)(
  '%s captured source-time candidates remove the observed dip through the real chart math',(_name,readings,published)=>{
    const history=reconstructHistory([...readings]).history;
    const actuals=mergeActuals(published,[],[],history.map(r=>({at:new Date(r.at),views:r.views})),Date.parse('2026-09-07T12:00:00Z'));
    const series=buildSeries({actuals,baseline:null,est30:null,mult:{},horizonDay:4});
    const measured=series.filter(p=>p.kind==='measured');
    expect(measured.length).toBeGreaterThan(1);
    expect(measured.every((p,i)=>!i||p.views>=measured[i-1].views)).toBe(true);
  });
const sample=(eventId:string,date:string|null,views:number,age:string|null=null):RawReading=>({eventId,videoId:'test',views,
  fetchedAt:Date.parse('2026-09-07T11:30:00Z'),headers:{date,age}});
test('a newer source-time decrease is preserved; sorting does not force growth',()=>{
  const history=reconstructHistory([
    sample('new','Mon, 07 Sep 2026 11:20:00 GMT',90),
    sample('old','Mon, 07 Sep 2026 11:10:00 GMT',100),
  ]).history;
  expect(history.map(r=>r.views)).toEqual([100,90]);
});
test.each([null,'invalid','Mon, 07 Sep 2026 12:00:00 GMT'])(
  'missing/invalid/future Date %s cannot invent a historical timestamp from Age alone',date=>{
    const r=sample('unknown',date,100,'600');
    const result=reconstructHistory([r]);
    expect(result.history[0]).toMatchObject({at:r.fetchedAt,timeBasis:'fetch-time-only'});
  });
test('conflicting counts with the same response timestamp remain visible as conflicts, not silently overwritten',()=>{
  const result=reconstructHistory([
    sample('one','Mon, 07 Sep 2026 11:10:00 GMT',100),
    sample('two','Mon, 07 Sep 2026 11:10:00 GMT',90),
  ]);
  expect(result.history).toHaveLength(2);
  expect(result.history.every(r=>r.conflict)).toBe(true);
  expect(result.audit).toHaveLength(2);
});
test.each(['1EEw36H2zLo','YBvdMVY7LW4'])(
  '%s response-time RSS history coexists with the captured API counts without moving API timestamps',id=>{
    const rows=(raw as (RawReading & {apiViews:number;apiAt:number})[]).filter(r=>r.videoId===id);
    const rss=reconstructHistory(rows).history;
    const api=rows.map(r=>({at:new Date(r.apiAt),views:r.apiViews}));
    const actuals=mergeActuals('2026-09-03T00:00:00Z',[],api,rss.map(r=>({at:new Date(r.at),views:r.views})),Date.parse('2026-09-07T12:00:00Z'));
    expect(actuals.every((r,i)=>!i||r.views>=actuals[i-1].views)).toBe(true);
    // The shared merger compresses plateau interiors; surviving API points retain their
    // actual receipt timestamps and values, never the RSS response clock.
    const retainedApi=actuals.filter(r=>r.source==='sample');
    expect(retainedApi.length).toBeGreaterThan(0);
    for(const r of retainedApi) expect(api.some(a=>a.at.toISOString()===r.at&&a.views===r.views)).toBe(true);
    expect(actuals.at(-1)!.views).toBe(rows.at(-1)!.apiViews);
  });
test('the cached clock agrees with an independently stored earlier count to HTTP one-second precision',()=>{
  const stored=[
    {id:'1EEw36H2zLo',at:Date.parse('2026-09-07T11:11:24.984Z'),views:88653},
    {id:'YBvdMVY7LW4',at:Date.parse('2026-09-07T11:11:30.948Z'),views:454699},
  ];
  for(const previous of stored){
    const candidates=reconstructHistory(raw.filter(r=>r.videoId===previous.id)).history;
    const old=candidates.find(p=>p.views===previous.views)!;
    expect(old).toBeDefined();
    expect(Math.abs(old.at-previous.at)).toBeLessThan(1000);
  }
});
