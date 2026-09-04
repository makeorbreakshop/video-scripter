export type BackfillPassResult = 'busy' | 'progress' | 'failed' | 'complete';
export async function runBackfillLoop(options: {
  maxPasses: number;
  signal: AbortSignal;
  runPass: () => Promise<BackfillPassResult>;
  wait: (milliseconds: number) => Promise<void>;
}): Promise<'complete' | 'stopped' | 'exhausted'> {
  if (!Number.isInteger(options.maxPasses) || options.maxPasses < 1) throw new Error('maxPasses must be positive');
  let passes = 0;
  while (passes < options.maxPasses && !options.signal.aborted) {
    const result = await options.runPass();
    if (result === 'complete') return 'complete';
    if (result !== 'busy') passes++;
    if (options.signal.aborted || passes === options.maxPasses) break;
    await options.wait(result === 'progress' ? 3_600_000 : 60_000);
  }
  return options.signal.aborted ? 'stopped' : 'exhausted';
}
