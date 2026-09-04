// One-shot: create video_score_history + the v5 columns, then copy every existing video_scores
// row into history VERBATIM with its current model_version.
//
//   npx tsx scripts/migrate-score-history.ts --explain     plan only, writes nothing
//   npx tsx scripts/migrate-score-history.ts --apply       DDL in one transaction, then the copy
//
// The copy is batched on the video_id keyset (video_scores' primary key), ~700K rows, so no
// single statement holds a long transaction open against a database that has had IO incidents.
// It is idempotent by construction only if run once: history is append-only and has no unique
// key, so --apply refuses if history already holds rows tagged by this backfill.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import fs from 'node:fs';
import pg from 'pg';

const EXPLAIN = process.argv.includes('--explain');
const APPLY = process.argv.includes('--apply');
const BATCH = Number(process.argv[process.argv.indexOf('--batch') + 1]) || 20000;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
pool.on('connect', (c: pg.PoolClient) => { c.query('set statement_timeout = 600000').catch(() => {}); });
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

// video_scores -> video_score_history, verbatim. The v3/v4-only facts that history has no column
// for ride in `extra`, so nothing is lost.
const SELECT_COLS = `
  s.video_id, s.channel_id, s.model_version, s.scored_at,
  coalesce(s.age_days, s.snapshot_day) as age_days, s.views, s.score, s.same_age_ratio,
  s.typical_at_age, s.n_typical, s.typical_measured_share, s.projection, s.projection_horizon,
  s.est30, s.baseline, s.n_baseline, s.confidence,
  jsonb_strip_nulls(jsonb_build_object(
    'q', s.q, 'n_same_age', s.n_same_age, 'snapshot_day', s.snapshot_day,
    'typical_neff', s.typical_neff, 'priors_from_lifetime', s.priors_from_lifetime,
    'backfilled_from', 'video_scores'
  )) as extra`;

// The cursor is computed by POSTGRES (`max(video_id)` over the page), never in JS. This database
// is en_US.UTF-8, whose text ordering is not codepoint order, while JS string comparison is; a
// first run took the page maximum with a JS reduce and the keyset ranges overlapped, copying
// 193,545 rows for 186,743 videos (nothing skipped, 6,802 duplicated). Collating the scan as "C"
// to match JS would instead cost a full sort per batch, so the page keeps the index's own order
// and only the cursor moves into SQL.
const INSERT_SQL = `
with page as (
  select ${SELECT_COLS}
    from video_scores s
   where s.video_id > $1
   order by s.video_id
   limit $2
), ins as (
  insert into video_score_history
    (video_id, channel_id, model_version, scored_at, age_days, views, score, same_age_ratio,
     typical_at_age, n_typical, typical_measured_share, projection, projection_horizon,
     est30, baseline, n_baseline, confidence, extra)
  select * from page
  returning 1
)
select (select max(video_id) from page) as next_cursor,
       (select count(*)::int from ins)  as n`;

async function main() {
  // Before the DDL the v5 columns do not exist, so the pre-flight plan is the shape that
  // actually matters: one keyset page off the primary key, no sort, no seq scan.
  if (EXPLAIN) {
    const plan = await pool.query(
      `explain (analyze false, verbose false)
       select s.* from video_scores s where s.video_id > '' order by s.video_id limit $1`,
      [BATCH]
    );
    console.log(plan.rows.map((r: any) => r['QUERY PLAN']).join('\n'));
    const c = await pool.query(`select count(*)::bigint as n from video_scores`);
    log(`video_scores rows: ${c.rows[0].n}; batch ${BATCH}`);
    return;
  }
  if (!APPLY) { console.error('pass --explain or --apply'); process.exit(2); }

  const already = await pool.query(
    `select count(*)::bigint as n from video_score_history where extra->>'backfilled_from' = 'video_scores'`
  ).catch(() => ({ rows: [{ n: '0' }] }));
  if (Number(already.rows[0].n) > 0) {
    console.error(`refusing: video_score_history already holds ${already.rows[0].n} backfilled rows`);
    process.exit(3);
  }

  // DDL: both files in ONE transaction, so a half-applied schema is not a state we can reach.
  const ddl = ['sql/scoring-v5.sql', 'sql/score-history.sql'].map((f) => fs.readFileSync(f, 'utf8')).join('\n;\n');
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(ddl);
    await c.query('commit');
    log('DDL applied (scoring-v5.sql + score-history.sql) in one transaction');
  } catch (e: any) {
    await c.query('rollback').catch(() => {});
    console.error('DDL failed, rolled back:', e.message);
    process.exit(1);
  } finally { c.release(); }

  // Now that the columns exist, plan the real statement's select before running 35 of them.
  const plan = await pool.query(
    `explain (analyze false, verbose false)
     select ${SELECT_COLS} from video_scores s where s.video_id > '' order by s.video_id limit $1`,
    [BATCH]
  );
  log(`plan:\n${plan.rows.map((r: any) => r['QUERY PLAN']).join('\n')}`);

  let cursor = '';
  let copied = 0;
  for (;;) {
    const r = await pool.query(INSERT_SQL, [cursor, BATCH]);
    const n = Number(r.rows[0]?.n ?? 0);
    if (!n) break;
    copied += n;
    cursor = r.rows[0].next_cursor;
    log(`copied ${copied} (cursor ${cursor})`);
    await new Promise((res) => setTimeout(res, 200));
  }
  const [vs, vh, sem] = await Promise.all([
    pool.query(`select count(*)::bigint as n from video_scores`),
    pool.query(`select count(*)::bigint as n from video_score_history`),
    pool.query(`select count(*)::bigint as n from video_score_history where model_version = 'v3.1-semantic-backfill-2026-09'`),
  ]);
  log(`done: copied ${copied}; video_scores ${vs.rows[0].n}; history ${vh.rows[0].n}; semantic-backfill label ${sem.rows[0].n}`);
}

await main();
await pool.end();
