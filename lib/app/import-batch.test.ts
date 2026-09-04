import {
  chunkIds, planImport, mapWithConcurrency, createOnceGuard, CLIENT_BATCH, SERVER_CHUNK,
} from './import-batch';

describe('chunkIds', () => {
  it('splits into runs of at most size', () => {
    expect(chunkIds([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it('is empty for no ids', () => {
    expect(chunkIds([], 25)).toEqual([]);
  });
  it('splits 474 into 10 client batches and 19 server chunks', () => {
    const ids = Array.from({ length: 474 }, (_, i) => `UC${i}`);
    expect(chunkIds(ids, CLIENT_BATCH)).toHaveLength(10);
    expect(chunkIds(ids, SERVER_CHUNK)).toHaveLength(19);
    expect(chunkIds(ids, CLIENT_BATCH).flat()).toEqual(ids);
  });
  it('does not care how big the list is', () => {
    const ids = Array.from({ length: 2000 }, (_, i) => String(i));
    expect(chunkIds(ids, 25).flat()).toHaveLength(2000);
  });
});

describe('planImport', () => {
  it('adds what is new and skips what is tracked', () => {
    expect(planImport(['a', 'b', 'c'], ['b'])).toEqual({ add: ['a', 'c'], skip: ['b'] });
  });
  it('is idempotent: a second post of the same ids plans no work', () => {
    const first = planImport(['a', 'b'], []);
    expect(first.add).toEqual(['a', 'b']);
    const second = planImport(['a', 'b'], first.add);
    expect(second.add).toEqual([]);
    expect(second.skip).toEqual(['a', 'b']);
  });
  it('de-duplicates the request itself', () => {
    expect(planImport(['a', 'a', 'b'], []).add).toEqual(['a', 'b']);
  });
});

describe('mapWithConcurrency', () => {
  it('keeps input order and never exceeds the limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return n * 2;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(out.map((r) => (r.ok ? r.value : null))).toEqual([2, 4, 6, 8, 10, 12, 14]);
  });

  it('hands back a failure instead of throwing, and finishes the rest', async () => {
    const out = await mapWithConcurrency(['a', 'bad', 'c'], 2, async (s) => {
      if (s === 'bad') throw new Error('nope');
      return s.toUpperCase();
    });
    expect(out[0]).toEqual({ ok: true, value: 'A' });
    expect(out[1].ok).toBe(false);
    expect(out[2]).toEqual({ ok: true, value: 'C' });
  });

  it('is empty for no items', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});

describe('createOnceGuard', () => {
  it('runs the first trigger and ignores the second', () => {
    const fn = jest.fn(() => 'made');
    const guard = createOnceGuard();
    expect(guard.run(fn)).toBe('made');
    expect(guard.run(fn)).toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(guard.done).toBe(true);
  });

  it('Enter then blur creates one group, not two', () => {
    const created: string[] = [];
    const guard = createOnceGuard();
    const commit = () => guard.run(() => created.push('Lasers'));
    commit(); // Enter
    commit(); // the blur Enter caused
    expect(created).toEqual(['Lasers']);
  });

  it('a fresh guard is a fresh commit', () => {
    const created: string[] = [];
    for (const name of ['one', 'two']) {
      const guard = createOnceGuard();
      guard.run(() => created.push(name));
      guard.run(() => created.push(name));
    }
    expect(created).toEqual(['one', 'two']);
  });
});
