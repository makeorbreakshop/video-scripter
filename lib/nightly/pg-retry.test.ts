import { withDeadlockRetry, DEADLOCK } from './pg-retry';

const deadlock = () => Object.assign(new Error('deadlock detected'), { code: DEADLOCK });
const noSleep = () => Promise.resolve();

describe('withDeadlockRetry', () => {
  it('returns on first success', async () => {
    const fn = jest.fn().mockResolvedValue(42);
    await expect(withDeadlockRetry(fn, { sleep: noSleep })).resolves.toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries deadlocks and succeeds', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(deadlock())
      .mockRejectedValueOnce(deadlock())
      .mockResolvedValue('ok');
    await expect(withDeadlockRetry(fn, { sleep: noSleep })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('gives up after the attempt budget and rethrows the deadlock', async () => {
    const fn = jest.fn().mockRejectedValue(deadlock());
    await expect(withDeadlockRetry(fn, { attempts: 3, sleep: noSleep })).rejects.toMatchObject({ code: DEADLOCK });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry non-deadlock errors', async () => {
    const fn = jest.fn().mockRejectedValue(Object.assign(new Error('rls'), { code: '42501' }));
    await expect(withDeadlockRetry(fn, { sleep: noSleep })).rejects.toMatchObject({ code: '42501' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('backs off increasingly between attempts', async () => {
    const delays: number[] = [];
    const fn = jest.fn().mockRejectedValueOnce(deadlock()).mockRejectedValueOnce(deadlock()).mockResolvedValue(1);
    await withDeadlockRetry(fn, { baseDelayMs: 100, sleep: (ms) => { delays.push(ms); return Promise.resolve(); } });
    expect(delays).toEqual([100, 200]);
  });
});
