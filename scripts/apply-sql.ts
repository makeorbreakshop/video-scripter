// Apply a .sql file to the database over DATABASE_URL. Direct Postgres only — never supabase-js.
//   npx tsx scripts/apply-sql.ts sql/channel-directory.sql
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });
import fs from 'node:fs';
import pg from 'pg';

const file = process.argv[2];
if (!file) { console.error('usage: apply-sql.ts <file.sql>'); process.exit(1); }
const sql = fs.readFileSync(file, 'utf8');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  // Directory rebuilds run ~50s; the pooler's default statement_timeout would roll the whole file back.
  await client.query('set statement_timeout = 0');
  const t0 = Date.now();
  await client.query(sql);
  console.log(`applied ${file} in ${Date.now() - t0}ms`);
} finally {
  await client.end();
}
