import { loadScoringDependencies } from './prior-load';
import { emptyObservationState, encodeObservationState } from './observation-state';
const refs = new Map([
  ['a', [{id:'p',pub:0,ageDays:1}]],
  ['b', [{id:'q',pub:0,ageDays:1}]],
]);
const targets=[{id:'a'},{id:'b'}];
function database(ready: string[], race: string[] = []) {
  const bodyIds:string[][]=[];
  const q=jest.fn(async(sql:string, args:any[] = [])=>{
    if(sql.includes('cache-ready'))return args[0].filter((id:string)=>ready.includes(id)).map((video_id:string)=>({video_id}));
    if(sql.includes('cache-read')) {
      bodyIds.push(args[0]);
      return args[0].filter((id:string)=>ready.includes(id)&&!race.includes(id)).map((video_id:string)=>({
        video_id,format:2,obs:encodeObservationState(emptyObservationState(video_id,'2026-01-01T00:00:00Z')),
      }));
    }
    throw Error('unexpected query');
  });
  return {q,bodyIds};
}
test('does not download any histories for incomplete dependency sets',async()=>{
 const db=database(['a','b','p']);
 const result=await loadScoringDependencies(db.q,targets,refs);
 expect(result.ready).toEqual([{id:'a'}]);expect(result.blocked).toEqual([{id:'b'}]);
 expect(result.missingIds).toEqual(['q']);expect([...result.missingByTarget]).toEqual([['b',['q']]]);
 expect(db.bodyIds.flat().sort()).toEqual(['a','p']);
});
test('all blocked means zero body reads, while missing IDs still request repair',async()=>{
 const db=database(['a','b']);const result=await loadScoringDependencies(db.q,targets,refs);
 expect(db.bodyIds).toEqual([]);expect(result.missingIds.sort()).toEqual(['p','q']);expect([...result.missingByTarget]).toEqual([['a',['p']],['b',['q']]]);
});
test('a dependency dirtied after preflight is never scored with stale data',async()=>{
 const db=database(['a','b','p','q'],['p']);const result=await loadScoringDependencies(db.q,targets,refs);
 expect(result.ready).toEqual([{id:'b'}]);expect(result.missingIds).toEqual(['p']);expect([...result.missingByTarget]).toEqual([['a',['p']]]);
});
test('shared dependencies and overlapping target/prior identities are downloaded once',async()=>{
 const db=database(['a','b','p']);
 const result=await loadScoringDependencies(db.q,targets,new Map([
 ['a',[{id:'p',pub:0,ageDays:1}]],['b',[{id:'p',pub:0,ageDays:1},{id:'a',pub:0,ageDays:1}]],
 ]));
 expect(result.ready).toEqual(targets);expect(db.bodyIds.flat().sort()).toEqual(['a','b','p']);
});
test('preflight errors fail without downloading bodies',async()=>{
 const q=jest.fn(async()=>{throw Error('offline')});
 await expect(loadScoringDependencies(q,targets,refs)).rejects.toThrow('offline');expect(q).toHaveBeenCalledTimes(1);
});
test('empty input performs no queries',async()=>{
 const db=database([]);expect((await loadScoringDependencies(db.q,[],refs)).ready).toEqual([]);expect(db.q).not.toHaveBeenCalled();
});
test('a missing target prevents downloading its healthy priors',async()=>{
 const db=database(['p']);const result=await loadScoringDependencies(db.q,[{id:'a'}],refs);
 expect(db.bodyIds).toEqual([]);expect(result.missingIds).toEqual(['a']);
});
test('readiness and body requests stay bounded at 100 distinct IDs',async()=>{
 const ids=Array.from({length:251},(_,i)=>`v${i}`);const db=database(ids);
 const result=await loadScoringDependencies(db.q,ids.map(id=>({id})),new Map());
 expect(result.ready).toHaveLength(251);
 for(const call of db.q.mock.calls)expect(call[1]![0].length).toBeLessThanOrEqual(100);
});
test('preflight misses remain visible in cache health counters',async()=>{
 const {obsCacheStats}=await import('./obs-cache');const before=obsCacheStats.misses;
 const db=database(['a','b']);await loadScoringDependencies(db.q,targets,refs);
 expect(obsCacheStats.misses-before).toBe(2);
});
