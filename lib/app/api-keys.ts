// Public API v1 bearer keys. Only a sha256 hash is stored, so a database dump does not hand out
// working keys and there is no way to show a key again after creation.
import { createHash, randomBytes } from 'crypto';
import { q, one } from '../admin/db';

/** Visible on every key so a leaked string is obviously ours and obviously a secret. */
export const KEY_PREFIX = 'cs_live_';
/** How much of the plaintext we keep in the clear, for "which key is this?" in the UI. */
const PREFIX_LEN = KEY_PREFIX.length + 6;

export interface ApiKeyRow {
  id: string;
  user_id: string;
  prefix: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export function hashKey(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

export function generateKey(): string {
  return KEY_PREFIX + randomBytes(24).toString('base64url');
}

export function prefixOf(plaintext: string): string {
  return plaintext.slice(0, PREFIX_LEN);
}

/**
 * Mint a key for a user. The plaintext is returned exactly once — the caller must show it and
 * then forget it; nothing else in the system can recover it.
 */
export async function createKey(userId: string, label?: string | null): Promise<{ key: string; row: ApiKeyRow }> {
  const key = generateKey();
  const row = await one<ApiKeyRow>(
    `insert into api_keys (user_id, key_hash, prefix, label) values ($1, $2, $3, $4)
     returning id, user_id, prefix, label, created_at, last_used_at, revoked_at`,
    [userId, hashKey(key), prefixOf(key), label ?? null]
  );
  return { key, row: row! };
}

/** Revoking is a soft delete: the row stays so last_used_at remains auditable. */
export async function revokeKey(userId: string, keyId: string): Promise<boolean> {
  const rows = await q(
    `update api_keys set revoked_at = now()
      where id = $1 and user_id = $2 and revoked_at is null
      returning id`,
    [keyId, userId]
  );
  return rows.length > 0;
}

export async function listKeys(userId: string): Promise<ApiKeyRow[]> {
  return q<ApiKeyRow>(
    `select id, user_id, prefix, label, created_at, last_used_at, revoked_at
       from api_keys where user_id = $1 order by created_at desc`,
    [userId]
  );
}
