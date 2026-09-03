import { encryptSecret, decryptSecret, isEncrypted, generateKey } from './crypto';

const KEY = generateKey();
beforeEach(() => { process.env.TOKEN_ENCRYPTION_KEY = KEY; });
afterEach(() => { delete process.env.TOKEN_ENCRYPTION_KEY; });

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a secret', () => {
    const token = '1//0abcdefgHIJKLmnop-refresh-token';
    expect(decryptSecret(encryptSecret(token))).toBe(token);
  });
  it('produces a different ciphertext every time (random iv)', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
  });
  it('is versioned so the scheme can be rotated', () => {
    expect(encryptSecret('x').startsWith('v1:')).toBe(true);
  });
  it('refuses to decrypt tampered ciphertext rather than returning garbage', () => {
    const enc = encryptSecret('secret');
    const parts = enc.split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => decryptSecret(parts.join(':'))).toThrow();
  });
  it('reads a legacy plaintext value unchanged, so migration can be gradual', () => {
    expect(isEncrypted('1//plain-token')).toBe(false);
    expect(decryptSecret('1//plain-token')).toBe('1//plain-token');
  });
  it('recognises its own output as encrypted', () => {
    expect(isEncrypted(encryptSecret('x'))).toBe(true);
  });
  it('fails loudly when no key is configured instead of storing plaintext', () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encryptSecret('x')).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });
  it('cannot decrypt with the wrong key', () => {
    const enc = encryptSecret('secret');
    process.env.TOKEN_ENCRYPTION_KEY = generateKey();
    expect(() => decryptSecret(enc)).toThrow();
  });
});
