import { generateKey, hashKey, prefixOf, KEY_PREFIX } from './api-keys';

describe('api keys', () => {
  it('generates prefixed, unguessable, distinct keys', () => {
    const a = generateKey();
    const b = generateKey();
    expect(a.startsWith(KEY_PREFIX)).toBe(true);
    expect(a).not.toBe(b);
    // 24 random bytes -> 32 base64url chars of entropy after the prefix.
    expect(a.length - KEY_PREFIX.length).toBe(32);
    expect(a.slice(KEY_PREFIX.length)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('hashes deterministically and differently per key', () => {
    const a = generateKey();
    expect(hashKey(a)).toBe(hashKey(a));
    expect(hashKey(a)).not.toBe(hashKey(generateKey()));
    expect(hashKey(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never leaks enough plaintext in the prefix to be useful', () => {
    const key = generateKey();
    const p = prefixOf(key);
    expect(key.startsWith(p)).toBe(true);
    expect(p.length).toBe(KEY_PREFIX.length + 6);
    expect(key.length - p.length).toBeGreaterThan(24);
  });
});
