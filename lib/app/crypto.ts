// Envelope encryption for secrets at rest (currently YouTube refresh tokens).
//
// AES-256-GCM: authenticated, so a tampered value throws instead of decrypting to garbage.
// The stored form is self-describing and versioned — "v1:<iv>:<tag>:<ciphertext>", all base64 —
// so the scheme can be rotated later without a flag day, and a legacy plaintext value is
// passed through unchanged so migration can be gradual.
//
// The key lives in TOKEN_ENCRYPTION_KEY (base64, 32 bytes). There is deliberately no
// fallback: a missing key throws rather than silently writing plaintext.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const ALGO = 'aes-256-gcm';

/** A fresh base64 key, for `TOKEN_ENCRYPTION_KEY`. Used by tests and by scripts/gen-key.ts. */
export function generateKey(): string {
  return randomBytes(32).toString('base64');
}

function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('TOKEN_ENCRYPTION_KEY is not set — generate one with `npx tsx scripts/gen-key.ts`');
  }
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded');
  return buf;
}

/** True for values this module produced. Anything else is treated as legacy plaintext. */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(`${VERSION}:`) && value.split(':').length === 4;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

/** Decrypts our format; returns a legacy plaintext value unchanged. */
export function decryptSecret(stored: string): string {
  if (!isEncrypted(stored)) return stored;
  const [, ivB64, tagB64, dataB64] = stored.split(':');
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}
