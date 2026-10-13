/** Incomplete work remains inside the retry window; never acknowledge a capped pass. */
export async function commitSemanticWatermark(
 state:{dry:boolean;capped:boolean},write:()=>Promise<void>,
):Promise<void>{
 if(state.dry)return;
 if(state.capped)throw Error('semantic synchronization incomplete at its work cap; watermark retained for bounded recovery');
 await write();
}
