import {readStatsResponse} from './stats-response';
test('retries a truncated response body and counts both requests',async()=>{
 const fetchResponse=jest.fn().mockResolvedValueOnce({ok:true,json:async()=>{throw new Error('body timeout');}})
  .mockResolvedValueOnce({ok:true,json:async()=>({items:[{id:'video'}]})});
 const onAttempt=jest.fn();
 const result=await readStatsResponse({fetchResponse,onAttempt,maxAttempts:2,wait:async()=>{}});
 expect(result?.data.items).toEqual([{id:'video'}]);expect(onAttempt).toHaveBeenCalledTimes(2);
});
test('exhausted request budget returns retryable work without exceeding its allowance',async()=>{
 const onAttempt=jest.fn();const fetchResponse=jest.fn().mockRejectedValue(new Error('unreachable'));
 expect(await readStatsResponse({fetchResponse,onAttempt,maxAttempts:2,wait:async()=>{}})).toBeNull();
 expect(onAttempt).toHaveBeenCalledTimes(2);
});
test('HTTP quota rejection returns immediately without retrying or reading a body',async()=>{
 const json=jest.fn();const response={ok:false,status:403,json} as unknown as Response;
 const fetchResponse=jest.fn().mockResolvedValue(response);
 const result=await readStatsResponse({fetchResponse,onAttempt:jest.fn(),maxAttempts:3});
 expect(result?.response.status).toBe(403);expect(fetchResponse).toHaveBeenCalledTimes(1);expect(json).not.toHaveBeenCalled();
});
