// Live-write smoke test for every touch_queue producer mode, run AS THE
// PRODUCERS RUN: Supabase REST with the anon key, so RLS/policy changes are
// exercised exactly as the extension (click/passive/feed) and the Render
// WebSub service (websub) hit them. Run before merging any security/RLS
// migration; exits non-zero if any producer path would break.
//
//   npx tsx scripts/smoke-producers.ts
//
// Writes four throwaway rows (and one duplicate to prove on_conflict dedupe
// still works under RLS), verifies them over direct Postgres, then deletes.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_POOLER_URL || process.env.DATABASE_URL,
  max: 1,
});

// Representative payloads per producer, mirroring real traffic shapes
// (including the internal source markers the 2026-09-01 policy regression
// rejected: feed:/results and websub's non-URL marker).
// Refs must be shape-valid video ids (^[A-Za-z0-9_-]{11}$) and websub markers
// need a full UC id — the policy validates payload shape, which is exactly
// what makes this smoke test representative.
const STAMP = Date.now().toString(36).slice(-5);
const SMOKE_UC = `UCsmoke${STAMP}`.padEnd(24, '0'); // UC + 22 chars
const CASES = [
  { mode: 'click', ref: `smkclk${STAMP}`, source_url: 'https://www.youtube.com/watch?v=smoke', hint: 'smoke click' },
  { mode: 'passive', ref: `smkpas${STAMP}`, source_url: 'https://www.youtube.com/watch?v=smoke', hint: null },
  { mode: 'feed', ref: `smkfed${STAMP}`, source_url: 'feed:/results', hint: 'smoke feed' },
  { mode: 'websub', ref: `smkwsb${STAMP}`, source_url: `websub:${SMOKE_UC}`, hint: null },
];

async function anonInsert(rows: object[]) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/touch_queue?on_conflict=kind,ref`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  return { ok: res.ok, status: res.status, body: res.ok ? '' : (await res.text()).slice(0, 200) };
}

let failed = 0;
const report = (name: string, ok: boolean, detail: string) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(28)} ${detail}`);
};

try {
  // 1. Each producer mode writes as anon.
  for (const c of CASES) {
    const r = await anonInsert([{ kind: 'video', ref: c.ref, source_url: c.source_url, mode: c.mode, hint: c.hint }]);
    report(`insert mode=${c.mode}`, r.ok, r.ok ? `HTTP ${r.status}` : `HTTP ${r.status} ${r.body}`);
  }

  // 2. Duplicate insert must be accepted (ignore-duplicates), not 401/409 —
  //    this is the path the SELECT revoke broke.
  const dup = await anonInsert([
    { kind: 'video', ref: CASES[0].ref, source_url: CASES[0].source_url, mode: 'click', hint: null },
  ]);
  report('dedupe (on_conflict as anon)', dup.ok, dup.ok ? `HTTP ${dup.status}` : `HTTP ${dup.status} ${dup.body}`);

  // 3. Rows actually landed (verified over direct Postgres, not REST).
  const refs = CASES.map((c) => c.ref);
  const { rows } = await pool.query(
    `select ref, mode from touch_queue where ref = any($1)`,
    [refs]
  );
  report('rows landed', rows.length === CASES.length, `${rows.length}/${CASES.length} present`);

  // 4. Anon must NOT be able to read processing state (the security goal —
  //    prove the fix didn't quietly reopen reads).
  const read = await fetch(`${SUPABASE_URL}/rest/v1/touch_queue?select=processed_at&limit=1`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
  });
  report('anon read still blocked', !read.ok, `HTTP ${read.status}`);
} finally {
  const del = await pool.query(`delete from touch_queue where ref like 'smk%' and ref like '%' || $1`, [STAMP]);
  console.log(`cleanup: ${del.rowCount} smoke rows deleted`);
  await pool.end();
}

console.log(failed ? `\n${failed} producer path(s) BROKEN — do not merge.` : '\nAll producer paths healthy.');
process.exit(failed ? 1 : 0);
