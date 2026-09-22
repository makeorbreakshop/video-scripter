import { describe, expect, it } from '@jest/globals';
import { backoffMs, retryable } from './jev';

describe('retryable', () => {
  it('retries the two documented backpressure codes', () => {
    expect(retryable(429)).toBe(true);
    expect(retryable(529)).toBe(true);
  });
  it('does not retry a malformed request, which will never succeed', () => {
    expect(retryable(422)).toBe(false);
    expect(retryable(401)).toBe(false);
  });
});

describe('backoffMs', () => {
  it('grows exponentially and caps at 30s', () => {
    expect(backoffMs(1, () => 1)).toBe(1_000);
    expect(backoffMs(4, () => 1)).toBe(8_000);
    expect(backoffMs(20, () => 1)).toBe(30_000);
  });
  it('is fully jittered, so twelve workers do not retry in lockstep', () => {
    expect(backoffMs(5, () => 0)).toBe(0);
    expect(backoffMs(5, () => 0.5)).toBe(8_000);
  });
});
