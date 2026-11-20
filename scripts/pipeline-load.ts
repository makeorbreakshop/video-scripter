// U2 of docs/plans/2026-11-20-local-pipeline-db.md: fill the local pipeline database without
// reading Supabase in bulk.
//
//   readings  every archived R2 day (readings/source=<rss|api>/day=…) → rss_samples / view_samples
//   mirror    the nightly export mirrors (~/.cache/video-scripter/table-exports/*.sqlite)
//             → videos, video_scores, view_snapshots (the projected columns they hold)
//   tail      the days R2 does not hold yet, from Supabase, one bounded day per statement
//   latest    rebuild rss_latest from the loaded rss_samples
//   quarantine  replay rss-poll's quarantined journals (readings Supabase never took) into local
//   state     copy rss_response_state (8 MB) — run right before turning PIPELINE_SHADOW on
//   parity    per day and source: local count vs the R2 index (archived days) and vs Supabase
//             (unarchived days) — check A1
//
// Every load runs with session_replication_role = replica, so the observation triggers do not
// fan a historical backfill out into the dirty queues. Each step is idempotent (on conflict do
// nothing), so a rerun only fills gaps.
//
// Usage: npx tsx scripts/pipeline-load.ts <readings|mirror|tail|latest|state|parity|all> [--from D] [--to D]
//   PIPELINE_DATABASE_URL  local target (default postgresql://localhost:5434/channelsmith_pipeline)
//   DATABASE_SESSION_URL / DATABASE_URL  Supabase, for `tail` and `parity` only
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parse as parseConn } from 'pg-connection-string';
import { r2Config, getObject, listObjects } from '../lib/readings/archive';
import { pipelineDatabaseUrl, pipelinePool, closePipelinePool } from '../lib/db/pipeline';
import { shadowChunks, shadowSave, FileShadowLedger, type ShadowLedger } from '../lib/rss/pipeline-shadow';
import { DiskStateCache } from '../lib/rss/response-state-cache';

const PSQL = '/opt/homebrew/opt/postgresql@17/bin/psql';
const LOCAL = pipelineDatabaseUrl();
const CACHE = path.join(os.homedir(), '.cache', 'video-scripter', 'pipeline-load');
const MIRRORS = path.join(os.homedir(), '.cache', 'video-scripter', 'table-exports');

const args = process.argv.slice(2);
const step = args[0] ?? 'all';
const arg = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const from = arg('--from');
const to = arg('--to');
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

/** psql against a connection string, credentials through the environment, never argv. */
function psqlEnv(url: string): NodeJS.ProcessEnv {
  const c = parseConn(url);
  return {
    ...process.env,
    PGHOST: c.host ?? 'localhost', PGPORT: String(c.port ?? 5432), PGDATABASE: c.database ?? 'postgres',
    PGUSER: c.user ?? process.env.USER, PGPASSWORD: c.password ?? '',
    PGSSLMODE: /localhost|127\.0\.0\.1/.test(c.host ?? '') ? 'disable' : 'require',
  };
}

function psql(url: string, sql: string, opts: { stdin?: NodeJS.ReadableStream; stdout?: NodeJS.WritableStream } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(PSQL, ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql], { env: psqlEnv(url) });
    let out = '', err = '';
    if (opts.stdout) p.stdout.pipe(opts.stdout); else p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    if (opts.stdin) opts.stdin.pipe(p.stdin); else p.stdin.end();
    p.on('close', (code) => code === 0 ? resolve(out.trim()) : reject(new Error(`psql exit ${code}: ${err.trim()}`)));
  });
}

function supabaseUrl(): string {
  const u = process.env.DATABASE_SESSION_URL || process.env.DATABASE_URL;
  if (!u) throw new Error('no DATABASE_SESSION_URL / DATABASE_URL for the Supabase side');
  return u;
}

const inRange = (d: string) => (!from || d >= from) && (!to || d <= to);

// ---- readings ------------------------------------------------------------------------------

type Source = 'rss' | 'api';
const STAGE_DDL = `create unlogged table if not exists pipeline_load_stage (
  video_id text, at_ms bigint, views bigint, likes bigint, time_basis text,
  model_eligible boolean, conflicted boolean, received_ms bigint)`;

const MERGE: Record<Source, string> = {
  rss: `insert into rss_samples (video_id, at, views, likes, time_basis, received_at, model_eligible, conflicted)
        select video_id, timestamptz 'epoch' + at_ms * interval '1 millisecond', views, likes,
               coalesce(time_basis, 'legacy-fetch'),
               case when received_ms is null then null else timestamptz 'epoch' + received_ms * interval '1 millisecond' end,
               coalesce(model_eligible, true), coalesce(conflicted, false)
          from pipeline_load_stage
        on conflict do nothing`,
  api: `insert into view_samples (video_id, sampled_at, view_count, like_count)
        select video_id, timestamptz 'epoch' + at_ms * interval '1 millisecond', views, likes
          from pipeline_load_stage where views is not null
        on conflict do nothing`,
};

async function archivedDays(source: Source, ranged = true): Promise<{ day: string; key: string; size: number }[]> {
  const cfg = r2Config();
  if (!cfg) throw new Error('no R2 credentials');
  return (await listObjects(cfg, `readings/source=${source}/`))
    .filter((o) => o.key.endsWith('/part-0.parquet'))
    .map((o) => ({ day: o.key.match(/day=(\d{4}-\d{2}-\d{2})/)![1], key: o.key, size: o.size }))
    .filter((d) => !ranged || inRange(d.day))
    .sort((a, b) => a.day.localeCompare(b.day));
}

async function fetchDay(key: string, size: number): Promise<string> {
  const local = path.join(CACHE, key);
  const have = await fs.stat(local).catch(() => null);
  if (have && have.size === size) return local;
  const buf = await getObject(r2Config()!, key);
  if (!buf) throw new Error(`R2 object missing: ${key}`);
  await fs.mkdir(path.dirname(local), { recursive: true });
  await fs.writeFile(local, buf);
  return local;
}

async function loadReadings() {
  const { DuckDBInstance } = await import('@duckdb/node-api');
  const duck = await DuckDBInstance.create(':memory:', { memory_limit: '2GB', threads: '4' });
  const conn = await duck.connect();
  await psql(LOCAL, STAGE_DDL);
  for (const source of ['rss', 'api'] as Source[]) {
    for (const d of await archivedDays(source)) {
      const t0 = Date.now();
      const file = await fetchDay(d.key, d.size);
      const csv = path.join(CACHE, `stage-${source}-${d.day}.csv`);
      // Optional columns are absent from days archived before 2026-09-08; the union_by_name
      // trick gives them as NULL there instead of failing the read.
      const cols = (await conn.runAndReadAll(`select name from parquet_schema('${file}')`)).getRows().map((r) => String(r[0]));
      const col = (c: string, t: string) => cols.includes(c) ? c : `null::${t}`;
      await conn.run(`copy (select video_id, "at", views, likes, ${col('time_basis', 'varchar')},
          ${col('model_eligible', 'boolean')}, ${col('conflicted', 'boolean')}, ${col('received_at', 'bigint')}
        from read_parquet('${file}')) to '${csv}' (format csv, header false)`);
      await psql(LOCAL, `truncate pipeline_load_stage`);
      await psql(LOCAL, `\\copy pipeline_load_stage from '${csv}' with (format csv)`);
      const merged = await psql(LOCAL, `set session_replication_role = replica; ${MERGE[source]}`);
      await fs.rm(csv, { force: true });
      log(`readings ${source} ${d.day}: ${merged.split('\n').pop()} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    }
  }
  await psql(LOCAL, `drop table if exists pipeline_load_stage`);
}

// ---- export mirrors ------------------------------------------------------------------------

const MIRROR_TABLES = ['videos', 'video_scores', 'view_snapshots'] as const;

async function loadMirrors() {
  const files = await fs.readdir(MIRRORS);
  for (const table of MIRROR_TABLES) {
    const file = files.find((f) => f.startsWith(`${table}-`) && f.endsWith('.sqlite'));
    if (!file) throw new Error(`no export mirror for ${table}`);
    const t0 = Date.now();
    const db = new DatabaseSync(path.join(MIRRORS, file), { readOnly: true });
    const csv = path.join(CACHE, `mirror-${table}.csv`);
    await fs.mkdir(CACHE, { recursive: true });
    const fh = await fs.open(csv, 'w');
    let n = 0;
    // key + body per line; body is the projection's JSON, which jsonb_populate_record maps onto
    // the table by column name (extra keys ignored, missing columns default).
    const esc = (s: string) => `"${s.replaceAll('"', '""')}"`;
    let buf: string[] = [];
    for (const row of db.prepare('select key, body from rows').iterate() as Iterable<{ key: string; body: string }>) {
      buf.push(`${esc(row.key)},${esc(row.body)}\n`);
      if (buf.length >= 10_000) { await fh.write(buf.join('')); buf = []; }
      n++;
    }
    if (buf.length) await fh.write(buf.join(''));
    await fh.close();
    db.close();
    await psql(LOCAL, `create unlogged table if not exists pipeline_mirror_stage (key text, body jsonb); truncate pipeline_mirror_stage`);
    await psql(LOCAL, `\\copy pipeline_mirror_stage from '${csv}' with (format csv)`);
    // The view_snapshots mirror is keyed by the snapshot uuid and its projection does not repeat it.
    const body = table === 'view_snapshots' ? `body || jsonb_build_object('id', key)` : 'body';
    // Only the columns the projection carries: jsonb_populate_record turns every other column
    // into NULL, which would override the table's defaults (videos.created_at is NOT NULL).
    const cols = (await psql(LOCAL, `select string_agg(quote_ident(c.column_name), ',' order by c.ordinal_position)
        from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = '${table}'
         and c.column_name in (select distinct jsonb_object_keys(${body}) from pipeline_mirror_stage)`));
    const insert = `insert into ${table} (${cols})
      select ${cols} from pipeline_mirror_stage, jsonb_populate_record(null::${table}, ${body}) r
      on conflict do nothing`;
    const merged = await psql(LOCAL, `set session_replication_role = replica; ${insert}`);
    await psql(LOCAL, `drop table pipeline_mirror_stage`);
    await fs.rm(csv, { force: true });
    log(`mirror ${table}: ${n.toLocaleString()} mirrored, ${merged.split('\n').pop()} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
}

// ---- unarchived tail -----------------------------------------------------------------------

function daysAfter(lastArchived: string, through: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${lastArchived}T00:00:00Z`) + 86_400_000; t <= Date.parse(`${through}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

// Readings are copied one UTC hour per statement: a whole rss day (~3 M rows) ran past the
// 280 s timeout on the IO-bound instance (2026-11-20). `slice` is an ISO hour start.
const TAIL: Record<Source | 'snapshots' | 'response_state', { select: (slice: string) => string; table: string; merge?: string }> = {
  rss: {
    select: (h) => `select video_id, at, views, likes, time_basis, received_at, archive_ref, model_eligible, conflicted
                        from rss_samples where at >= '${h}'::timestamptz and at < '${h}'::timestamptz + interval '1 hour'`,
    table: 'rss_samples',
  },
  api: {
    select: (h) => `select video_id, sampled_at, view_count, like_count, comment_count
                        from view_samples where sampled_at >= '${h}'::timestamptz and sampled_at < '${h}'::timestamptz + interval '1 hour'`,
    table: 'view_samples',
  },
  // Snapshot days newer than the export mirror. Same column order as the table, so `select *`
  // from the temp table lines up.
  snapshots: {
    select: (day) => `select id, video_id, snapshot_date, view_count, like_count, comment_count,
                             days_since_published, daily_views_rate, created_at
                        from view_snapshots where snapshot_date = '${day}'::date`,
    table: 'view_snapshots',
  },
  // rss-poll's per-channel freshness state (8 MB). Copied whole just before PIPELINE_SHADOW is
  // turned on; from then the shadow advances it locally. Newer state wins on a re-copy.
  response_state: {
    select: () => `select * from rss_response_state`,
    table: 'rss_response_state',
    merge: `on conflict (channel_id) do update set state = excluded.state`,
  },
};

/** One Supabase day → local, streamed COPY to COPY; no row is materialized in this process. */
function copyDay(source: Source | 'snapshots' | 'response_state', day: string): Promise<void> {
  const { select, table, merge = 'on conflict do nothing' } = TAIL[source];
  return new Promise((resolve, reject) => {
    // -q: without it the SET's command tag would be the first line of the COPY stream.
    const src = spawn(PSQL, ['-X', '-q', '-v', 'ON_ERROR_STOP=1',
      '-c', `set statement_timeout = '280s'`,
      '-c', `\\copy (${select(day).replace(/\s+/g, ' ')}) to stdout`], { env: psqlEnv(supabaseUrl()) });
    // Several -c run in one session, in order, so the temp table survives into the merge.
    const dst = spawn(PSQL, ['-X', '-v', 'ON_ERROR_STOP=1',
      '-c', `create temp table t (like ${table} including defaults)`,
      '-c', `\\copy t from pstdin`,
      '-c', `set session_replication_role = replica`,
      '-c', `insert into ${table} select * from t ${merge}`], { env: psqlEnv(LOCAL) });
    let err = '', out = '';
    src.stderr.on('data', (d) => { err += d; });
    dst.stderr.on('data', (d) => { err += d; });
    dst.stdout.on('data', (d) => { out += d; });
    src.stdout.pipe(dst.stdin);
    let done = 0, failed = false;
    const fin = (code: number | null) => {
      if (code !== 0 && !failed) { failed = true; reject(new Error(`tail ${source} ${day}: ${err.trim()}`)); return; }
      if (++done === 2 && !failed) { log(`tail ${source} ${day}: ${out.trim().split('\n').pop()}`); resolve(); }
    };
    src.on('close', fin); dst.on('close', fin);
  });
}

async function loadTail() {
  const today = new Date().toISOString().slice(0, 10);
  for (const source of ['rss', 'api'] as Source[]) {
    const last = (await archivedDays(source, false)).at(-1)?.day;
    if (!last) throw new Error(`no archived ${source} days`);
    for (const day of daysAfter(last, today).filter(inRange)) {
      const t0 = Date.now();
      for (let h = 0; h < 24; h++) {
        const slice = `${day}T${String(h).padStart(2, '0')}:00:00Z`;
        if (Date.parse(slice) > Date.now()) break;
        await copyDay(source, slice);
      }
      log(`  ${source} ${day} done (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    }
  }
  // The mirror's newest snapshot day may be partial (the export ran mid-day), so it is re-read.
  // An explicit --from earlier than that re-reads from there (a gap behind an earlier tail).
  const newest = await psql(LOCAL, `select max(snapshot_date)::text from view_snapshots`);
  const start = from && from < newest ? from : newest;
  for (const day of [start, ...daysAfter(start, today)].filter(inRange)) {
    const t0 = Date.now();
    await copyDay('snapshots', day);
    log(`  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
}

// ---- rss_latest ----------------------------------------------------------------------------

async function rebuildLatest() {
  const r = await psql(LOCAL, `set session_replication_role = replica;
    insert into rss_latest (video_id, at, views)
    select distinct on (video_id) video_id, at, views from rss_samples order by video_id, at desc
    on conflict (video_id) do update set at = excluded.at, views = excluded.views where excluded.at > rss_latest.at`);
  log(`rss_latest: ${r.split('\n').pop()}`);
}

// ---- parity (A1) ---------------------------------------------------------------------------

const DAY_COUNT: Record<Source, string> = {
  rss: `select (at at time zone 'UTC')::date::text, count(*) from rss_samples group by 1`,
  api: `select (sampled_at at time zone 'UTC')::date::text, count(*) from view_samples group by 1`,
};

async function parity(): Promise<boolean> {
  const cfg = r2Config()!;
  const sb = supabaseUrl();
  const today = new Date().toISOString().slice(0, 10);
  let ok = true;
  for (const source of ['rss', 'api'] as Source[]) {
    const local = new Map((await psql(LOCAL, DAY_COUNT[source])).split('\n').filter(Boolean)
      .map((l) => { const [d, n] = l.split('|'); return [d, Number(n)] as const; }));
    const archived = await archivedDays(source);
    for (const d of archived) {
      const idx = await getObject(cfg, d.key.replace('part-0.parquet', 'index.json'));
      const want = idx ? Number(JSON.parse(idx.toString('utf8')).rows) : NaN;
      const have = local.get(d.day) ?? 0;
      // An R2 day may hold a reading twice (two pollers at the same instant); the primary key
      // keeps one. Fewer local rows than R2 is a loss only if they are not such duplicates.
      if (have !== want) { ok = false; log(`A1 ${source} ${d.day}: local ${have} vs R2 ${want}`); }
    }
    const last = (await archivedDays(source, false)).at(-1)!.day;
    for (const day of daysAfter(last, today).filter(inRange)) {
      const t = source === 'rss' ? ['rss_samples', 'at'] : ['view_samples', 'sampled_at'];
      // The last line: psql prints the SET's command tag first.
      const want = Number((await psql(sb, `set statement_timeout = '280s';
        select count(*) from ${t[0]} where ${t[1]} >= '${day}'::date and ${t[1]} < '${day}'::date + 1`)).split('\n').pop());
      const have = local.get(day) ?? 0;
      // Today's day is still being written on Supabase; local can only trail it.
      const status = have === want ? 'ok' : day === today ? 'live' : 'MISMATCH';
      if (status === 'MISMATCH') ok = false;
      log(`A1 ${source} ${day}: local ${have} vs Supabase ${want} ${status}`);
    }
    log(`A1 ${source}: ${archived.length} archived day(s) checked against R2`);
  }
  // Snapshots: the last week, by snapshot_date (indexed on both sides). Older days came from the
  // export mirror; Supabase thins them past 30 days, so local may legitimately hold more.
  const q = `select snapshot_date::text, count(*) from view_snapshots
              where snapshot_date >= current_date - 7 group by 1 order by 1`;
  const rows = (u: string) => psql(u, q).then((t) => new Map(t.split('\n').filter(Boolean)
    .map((l) => { const [d, n] = l.split('|'); return [d, Number(n)] as const; })));
  const [mine, theirs] = await Promise.all([rows(LOCAL), rows(sb)]);
  for (const [day, want] of theirs) {
    const have = mine.get(day) ?? 0;
    const status = have === want ? 'ok' : day === today ? 'live' : 'MISMATCH';
    if (status === 'MISMATCH') ok = false;
    log(`A1 snapshots ${day}: local ${have} vs Supabase ${want} ${status}`);
  }
  return ok;
}

// ---- quarantined rss-poll journals ---------------------------------------------------------

/**
 * Readings Supabase never took: every logs/rss-poll-pending.failed-*.ndjson in the production
 * checkout (RSS_LOGS_DIR), oldest first, written locally through the same path as the live shadow.
 * Their responses are older than the local response state, so they land as late readings
 * (model_eligible = false), exactly as a late Supabase replay would. A chunk the live shadow
 * already wrote (its ledger) or this step already wrote (its own ledger) is skipped.
 */
async function loadQuarantine() {
  const dir = process.env.RSS_LOGS_DIR || path.join(os.homedir(), 'video-scripter-v2', 'video-scripter', 'logs');
  const files = (await fs.readdir(dir)).filter((f) => /^rss-poll-pending\.failed-.*\.ndjson$/.test(f)).sort();
  const live = new FileShadowLedger(path.join(dir, 'rss-poll-shadow-ledger.json'));
  const own = new FileShadowLedger(path.join(dir, 'pipeline-quarantine-ledger.json'), Date.now, 3650 * 86_400_000);
  const ledger: ShadowLedger = { has: (k) => live.has(k) || own.has(k), add: (k) => own.add(k) };
  const cache = new DiskStateCache(path.join(os.homedir(), '.cache', 'video-scripter', 'quarantine-state'));
  const pool = pipelinePool();
  const all = { files: 0, chunks: 0, rows: 0, skipped: 0, failed: 0 };
  for (const f of files) {
    const text = await fs.readFile(path.join(dir, f), 'utf8');
    const chunks = text.split('\n').filter(Boolean).flatMap((l) => {
      try { const b = JSON.parse(l); return [{ samples: b.samples ?? [], responses: b.responses ?? [] }]; }
      catch { return []; }
    });
    const t = await shadowChunks(chunks, ledger, (c) => shadowSave(pool, c, cache));
    all.files++; all.chunks += t.chunks; all.rows += t.rows; all.skipped += t.skipped; all.failed += t.failed;
    if (t.failed) log(`quarantine ${f}: ${t.failed} chunk(s) failed: ${t.errors[0]}`);
    if (all.files % 25 === 0 || all.files === files.length) log(`quarantine: ${all.files}/${files.length} files ${JSON.stringify(all)}`);
  }
  await closePipelinePool();
}

// ---- main ----------------------------------------------------------------------------------

await fs.mkdir(CACHE, { recursive: true });
if (step === 'readings' || step === 'all') await loadReadings();
if (step === 'mirror' || step === 'all') await loadMirrors();
if (step === 'tail' || step === 'all') await loadTail();
if (step === 'latest' || step === 'all') await rebuildLatest();
if (step === 'state' || step === 'all') await copyDay('response_state', 'all');
if (step === 'quarantine') await loadQuarantine();
if (step === 'parity' || step === 'all') {
  const ok = await parity();
  log(ok ? 'A1: pass' : 'A1: FAIL');
  if (!ok) process.exitCode = 1;
}
