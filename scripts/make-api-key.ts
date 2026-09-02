// Mint a public API v1 key for a user, by email.
//   npx tsx scripts/make-api-key.ts --email brandon@makeorbreakshop.com [--label "agents"] [--out .secrets/api-key.txt]
// The plaintext is written to --out (default .secrets/api-key-<local-part>.txt, gitignored) and
// never printed: once this script exits the only copy is that file.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });
import fs from 'fs';
import path from 'path';
import { createKey } from '../lib/app/api-keys';
import { one } from '../lib/admin/db';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
};

async function main() {
  const email = arg('email');
  if (!email) throw new Error('usage: make-api-key.ts --email <email> [--label <label>] [--out <path>]');
  const label = arg('label') || 'cli';

  const user = await one<{ id: string }>(`select id from app_users where lower(email) = lower($1)`, [email]);
  if (!user) throw new Error(`no app_users row for ${email} — sign in once at /app first, or insert the row`);

  const { key, row } = await createKey(user.id, label);
  const out = arg('out') || path.join('.secrets', `api-key-${email.split('@')[0]}.txt`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, key + '\n', { mode: 0o600 });
  console.log(`wrote key ${row.prefix}… (id ${row.id}, label "${label}") to ${out}`);
}

main().catch((e) => { console.error(String(e instanceof Error ? e.message : e)); process.exitCode = 1; }).finally(() => process.exit());
