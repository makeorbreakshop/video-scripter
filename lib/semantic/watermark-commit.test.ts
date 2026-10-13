import {commitSemanticWatermark} from './watermark-commit';
test('a capped pass cannot advance the durable watermark past unprocessed changes',async()=>{
 const write=jest.fn(async()=>{});
 await expect(commitSemanticWatermark({dry:false,capped:true},write)).rejects.toThrow(/incomplete/);
 expect(write).not.toHaveBeenCalled();
 await commitSemanticWatermark({dry:false,capped:false},write);expect(write).toHaveBeenCalledTimes(1);
 await commitSemanticWatermark({dry:true,capped:true},write);expect(write).toHaveBeenCalledTimes(1);
});
