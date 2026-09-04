import { runBackfillLoop } from './backfill-loop';

test('a busy hourly worker does not consume a corpus catch-up pass', async () => {
  const runPass = jest.fn().mockResolvedValueOnce('busy').mockResolvedValueOnce('complete');
  const wait = jest.fn().mockResolvedValue(undefined);
  expect(await runBackfillLoop({maxPasses:1,signal:new AbortController().signal,runPass,wait})).toBe('complete');
  expect(runPass).toHaveBeenCalledTimes(2);
  expect(wait).toHaveBeenCalledWith(60_000);
});

test('successful catch-up passes leave an hour for scheduled fresh scoring', async () => {
  const runPass = jest.fn().mockResolvedValueOnce('progress').mockResolvedValueOnce('complete');
  const wait = jest.fn().mockResolvedValue(undefined);
  await runBackfillLoop({maxPasses:2,signal:new AbortController().signal,runPass,wait});
  expect(wait).toHaveBeenCalledWith(3_600_000);
});

test('failed passes are bounded and abort interrupts the wait without another child', async () => {
  const controller = new AbortController();
  const runPass = jest.fn().mockResolvedValue('failed');
  const wait = jest.fn(async () => {controller.abort();});
  expect(await runBackfillLoop({maxPasses:2,signal:controller.signal,runPass,wait})).toBe('stopped');
  expect(runPass).toHaveBeenCalledTimes(1);
});

test('stops at the actual pass cap without another wait or child', async () => {
  const runPass = jest.fn().mockResolvedValue('failed');
  const wait = jest.fn().mockResolvedValue(undefined);
  expect(await runBackfillLoop({maxPasses:2,signal:new AbortController().signal,runPass,wait})).toBe('exhausted');
  expect(runPass).toHaveBeenCalledTimes(2);
  expect(wait).toHaveBeenCalledTimes(1);
  expect(wait).toHaveBeenCalledWith(60_000);
});
