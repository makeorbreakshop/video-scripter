import { take, consume, resetBuckets, RATE_LIMIT, RATE_WINDOW_MS, Bucket } from './rate-limit';

describe('take', () => {
  const T0 = 1_000_000;

  it('starts full', () => {
    const d = take(undefined, T0);
    expect(d.allowed).toBe(true);
    expect(d.remaining).toBe(RATE_LIMIT - 1);
  });

  it('drains to exactly the limit then refuses', () => {
    let bucket: Bucket | undefined;
    for (let i = 0; i < RATE_LIMIT; i++) {
      const d = take(bucket, T0);
      expect(d.allowed).toBe(true);
      bucket = d.bucket;
    }
    const denied = take(bucket, T0);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.retryAfter).toBeGreaterThanOrEqual(1);
  });

  it('refills continuously rather than on a window boundary', () => {
    let bucket: Bucket | undefined;
    for (let i = 0; i < RATE_LIMIT; i++) bucket = take(bucket, T0).bucket;
    expect(take(bucket, T0).allowed).toBe(false);
    // One token is worth window/limit ms.
    const oneToken = RATE_WINDOW_MS / RATE_LIMIT;
    expect(take(bucket, T0 + oneToken).allowed).toBe(true);
  });

  it('never refills past the limit however long it idles', () => {
    const d = take({ tokens: 0, updatedAt: T0 }, T0 + RATE_WINDOW_MS * 100);
    expect(d.remaining).toBe(RATE_LIMIT - 1);
  });

  it('treats a clock that went backwards as no elapsed time', () => {
    const d = take({ tokens: 5, updatedAt: T0 }, T0 - 60_000);
    expect(d.remaining).toBe(4);
  });
});

describe('consume', () => {
  beforeEach(resetBuckets);

  it('keeps separate buckets per key', () => {
    for (let i = 0; i < RATE_LIMIT; i++) consume('a', 1000);
    expect(consume('a', 1000).allowed).toBe(false);
    expect(consume('b', 1000).allowed).toBe(true);
  });
});
