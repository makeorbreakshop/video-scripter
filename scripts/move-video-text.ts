// Copy videos.description / metadata / llm_summary into video_text, in throttled batches.
//
// This is the one job in the speed work that walks the whole 4 GB `videos` table, so every
// safeguard is on: a keyset cursor on the primary key (never an OFFSET), a small batch, a sleep
// between batches, a check of pg_stat_activity every few batches that stops the run if anything
// heavy has appeared, and full resumability — the cursor is derived from what is already in
// video_text, so an interrupted run picks up where it stopped.
//
// It COPIES. Nothing is nulled or dropped here; `videos` stays authoritative until the readers
// are switched and verified. --verify re-reads a sample and compares both copies.
//
// Usage:
//   npx tsx scripts/move-video-text.ts --dry-run
//   npx tsx scripts/move-video-text.ts --batch 2000 --sleep-ms 250     # nightly
//   npx tsx scripts/move-video-text.ts --verify --sample 500
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { makeTimedPool } from '../lib/admin/db';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const arg = (f: string, d?: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const DRY = has('--dry-run') || has('--dry');
const BATCH = Number(arg('--batch', '2000'));
const SLEEP = Number(arg('--sleep-ms', '250'));
const MAX_BATCHES = Number(arg('--max-batches', '0'));

const pool = makeTimedPool({ connectionString: process.env.DATABASE_URL, max: 2, timeoutMs: 120_000 });
const q = async <T = any>(sql: string, params: any[] = []): Promise<T[]> => (await pool.query(sql, params)).rows as T[];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function heavy(): Promise<string | null> {
  const rows = await q<{ n: string }>(
    `select count(*)::text as n from pg_stat_activity
      where state = 'active' and now() - query_start > interval '2 minutes'
        and query not ilike '%pg_stat_activity%'`);
  return Number(rows[0]?.n ?? 0) > 0 ? 'a query has been running over two minutes' : null;
}

if (has('--verify')) {
  const sample = Number(arg('--sample', '500'));
  const bad = await q<{ id: string }>(
    `select v.id from video_text vt join videos v on v.id = vt.video_id
      where v.description is distinct from vt.description
         or v.metadata is distinct from vt.metadata
         or v.llm_summary is distinct from vt.llm_summary
      limit $1`, [sample]);
  const moved = Number((await q<{ n: string }>(`select count(*)::text as n from video_text`))[0].n);
  console.log(`verify: ${moved} row(s) moved, ${bad.length} mismatch(es)${bad.length ? ': ' + bad.slice(0, 5).map((r) => r.id).join(', ') : ''}`);
  await pool.end();
  process.exit(bad.length ? 1 : 0);
}

const stop = await heavy();
if (stop && !has('--force')) { console.error(`refusing to run: ${stop}`); await pool.end(); process.exit(2); }

// Resume point: the highest id already moved. `videos.id` is the primary key, so this is a
// single index probe and the walk below is one ordered index range per batch.
let cursor = (await q<{ id: string | null }>(`select max(video_id) as id from video_text`))[0]?.id ?? '';
console.log(`move-video-text: batch ${BATCH}, sleep ${SLEEP}ms${DRY ? ' [dry run]' : ''}, resuming after '${cursor}'`);

let moved = 0, batches = 0, bytes = 0;
const t0 = Date.now();
for (;;) {
  const rows = await q<{ id: string; b: string }>(
    `with page as (
       select id, description, metadata, llm_summary
         from videos where id > $1 order by id limit $2
     )
     ${DRY ? `select id, coalesce(length(description),0) + coalesce(length(metadata::text),0) as b from page`
           : `, ins as (
       insert into video_text (video_id, description, metadata, llm_summary, moved_at)
       select id, description, metadata, llm_summary, now() from page
       on conflict (video_id) do update
          set description = excluded.description, metadata = excluded.metadata,
              llm_summary = excluded.llm_summary, moved_at = excluded.moved_at
       returning video_id
     )
     select p.id, (coalesce(length(p.description),0) + coalesce(length(p.metadata::text),0))::text as b
       from page p where exists (select 1 from ins)`}`,
    [cursor, BATCH]);
  if (!rows.length) { console.log('nothing left to move'); break; }
  cursor = rows[rows.length - 1].id;
  moved += rows.length;
  bytes += rows.reduce((s, r) => s + Number(r.b ?? 0), 0);
  batches++;
  if (batches % 5 === 0) {
    const busy = await heavy();
    if (busy && !has('--force')) { console.error(`stopping early: ${busy} (${moved} moved — rerun to resume)`); break; }
    console.log(`  ${moved} moved · ${(bytes / 1e6).toFixed(0)} MB · ${((Date.now() - t0) / 1000).toFixed(0)}s · at '${cursor}'`);
  }
  if (MAX_BATCHES && batches >= MAX_BATCHES) { console.log(`--max-batches ${MAX_BATCHES} reached`); break; }
  await sleep(SLEEP);
}
console.log(`done: ${moved} row(s), ${(bytes / 1e6).toFixed(0)} MB of text, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
await pool.end();
