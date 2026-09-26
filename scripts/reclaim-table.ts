// One-time reclaim of a bloated table: measure, plan, rewrite, measure again.
//
// Plans with lib/ops/reclaim.ts (pg_repack when possible, VACUUM FULL otherwise), refuses without
// room for a second copy, and refuses a big rewrite without --approved. --dry-run measures and
// prints the plan, including the expected lock window, and changes nothing.
//
// Usage:
//   npx tsx scripts/reclaim-table.ts --table video_score_history --dry-run
//   npx tsx scripts/reclaim-table.ts --table video_score_history
//   npx tsx scripts/reclaim-table.ts --table videos --dry-run          # the approval brief
//   npx tsx scripts/reclaim-table.ts --table videos --approved         # only with Brandon's go
//   --method vacuum_full   force VACUUM FULL (holds ACCESS EXCLUSIVE for the whole rewrite)
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { planReclaim, repackCommand, VACUUM_FULL_SQL, type ReclaimPlan } from '../lib/ops/reclaim';
import { fetchDiskMetrics } from '../lib/ops/supabase-metrics';
import { recordOutcome } from '../lib/ops/job-outcomes';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const arg = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const TABLE = arg('--table');
const DRY = has('--dry-run');
if (!TABLE || !/^[a-z_][a-z0-9_]*$/.test(TABLE)) { console.error('--table <plain_name> required'); process.exit(2); }

const MB = 1024 * 1024;
// Measurements on the transaction pooler, read-only, bounded.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

async function measure() {
  const c = await pool.connect();
  try {
    await c.query(`begin read only`);
    // pgstattuple_approx reads every page not yet all-visible: right after a mass update that is
    // most of the heap and the toast (2026-09-26: > 120 s on videos). Read-only; bounded at 15 min.
    await c.query(`set local statement_timeout = '15min'`);
    const [r] = (await c.query(`
      select pg_total_relation_size(c.oid)::float8 as total, pg_relation_size(c.oid)::float8 as heap,
             coalesce(pg_total_relation_size(nullif(c.reltoastrelid, 0)), 0)::float8 as toast,
             pg_indexes_size(c.oid)::float8 as idx,
             exists (select 1 from pg_index i where i.indrelid = c.oid and i.indisprimary) as has_pk,
             (select approx_tuple_len::float8 from pgstattuple_approx(c.oid))
               + coalesce((select approx_tuple_len::float8 from pgstattuple_approx(nullif(c.reltoastrelid, 0))
                            where c.reltoastrelid <> 0), 0) as live,
             (select round(approx_free_percent::numeric, 1)::float8 from pgstattuple_approx(c.oid)) as free_pct,
             exists (select 1 from pg_extension where extname = 'pg_repack') as repack_ext
        from pg_class c where c.oid = ('public.' || $1)::regclass`, [TABLE])).rows;
    await c.query('commit');
    return r;
  } finally { c.release(); }
}

const fmt = (b: number) => `${Math.round(b / MB).toLocaleString('en-US')} MB`;
const show = (label: string, m: any) =>
  console.log(`${label}: total ${fmt(m.total)} (heap ${fmt(m.heap)}, toast ${fmt(m.toast)}, indexes ${fmt(m.idx)}); ` +
              `live heap+toast ${fmt(m.live)}, heap ${m.free_pct} % free`);

let plan: ReclaimPlan | null = null;
try {
  const before = await measure();
  show(`before ${TABLE}`, before);
  const disk = await fetchDiskMetrics();
  const dockerImage = spawnSync('docker', ['image', 'inspect', 'pg-repack:1.5.2-pg15'], { stdio: 'ignore' }).status === 0;
  plan = planReclaim({
    table: TABLE, totalBytes: before.total, heapBytes: before.heap, toastBytes: before.toast, indexBytes: before.idx,
    liveBytes: before.live, diskAvailBytes: disk?.availBytes ?? null, diskSizeBytes: disk?.sizeBytes ?? null,
    hasPrimaryKey: before.has_pk, repackAvailable: before.repack_ext && dockerImage, approved: has('--approved'),
  });
  if (arg('--method') === 'vacuum_full' && plan.method === 'pg_repack') {
    plan = planReclaim({ table: TABLE, totalBytes: before.total, heapBytes: before.heap, toastBytes: before.toast,
      indexBytes: before.idx, liveBytes: before.live, diskAvailBytes: disk?.availBytes ?? null,
      diskSizeBytes: disk?.sizeBytes ?? null, hasPrimaryKey: before.has_pk, repackAvailable: false, approved: has('--approved') });
  }
  console.log(`plan: ${plan.method}; reclaim ~${plan.reclaimMb} MB → ~${plan.afterMb} MB; ` +
              `lock ${plan.lockSeconds.min}-${plan.lockSeconds.max} s; run ${plan.runSeconds.min}-${plan.runSeconds.max} s` +
              (disk ? `; disk free ${fmt(disk.availBytes)}` : ''));
  for (const n of plan.notes) console.log(`  - ${n}`);

  if (DRY) {
    console.log('dry run: nothing changed');
  } else if (plan.method === 'refuse') {
    process.exitCode = 2;
  } else {
    const t0 = Date.now();
    let status: number | null;
    if (plan.method === 'pg_repack') {
      console.log(`$ ${repackCommand(TABLE).replace(/"\$DATABASE_SESSION_URL"/, '<session url>')}`);
      status = spawnSync('/bin/sh', ['-c', repackCommand(TABLE)], { stdio: 'inherit' }).status;
    } else {
      // VACUUM cannot run in a transaction block; psql on the SESSION pooler, one session.
      const cs = VACUUM_FULL_SQL(TABLE).map((sql) => `-c "${sql}"`).join(' ');
      status = spawnSync('/bin/sh', ['-c', `set -a; . ./.env.local; set +a; psql "$DATABASE_SESSION_URL" -X -v ON_ERROR_STOP=1 ${cs}`],
                         { stdio: 'inherit' }).status;
    }
    const secs = (Date.now() - t0) / 1000;
    const after = await measure();
    show(`after ${TABLE}`, after);
    const freed = before.total - after.total;
    console.log(`${plan.method} exit ${status}; ${secs.toFixed(1)} s; returned ${fmt(freed)} to the filesystem`);
    recordOutcome({ job: `reclaim-${TABLE}`, status: status === 0 ? 'progressed' : 'failed',
                    progressed: Math.round(freed / MB), backlog: null,
                    detail: `${plan.method} ${secs.toFixed(1)} s: ${fmt(before.total)} → ${fmt(after.total)}` });
    if (status !== 0) process.exitCode = 1;
  }
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
