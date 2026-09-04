import {refreshScoredChannels} from './channel-refresh';
test('one changed channel refreshes only that channel, with duplicate score writes deduplicated',async()=>{
 const query=jest.fn(async(sql:string,values?:any[])=>({rows:[{channel_id:'changed'}]}));
 expect(await refreshScoredChannels({query},['changed','changed'])).toEqual(['changed']);
 expect(query.mock.calls[0][1]).toEqual([['changed']]);
 expect(query.mock.calls[0][0]).toContain('select unnest($1::text[])');
});
test('no committed scores means no aggregate refresh',async()=>{
 const query=jest.fn(async()=>({rows:[]}));
 expect(await refreshScoredChannels({query},[])).toEqual([]);expect(query).not.toHaveBeenCalled();
});
