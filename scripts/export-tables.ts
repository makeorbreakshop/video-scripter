// Nightly: the non-readings tables the scoring harness needs, exported to R2 as parquet.
//
// The raw readings already live on R2 (scripts/archive-readings.ts). These are the tables that
// go WITH them — the corpus metadata, the stored scores, and the daily snapshot truth — so that
// a benchmark, a backtest or a band calibration can run end to end with ZERO production reads.
// That is the whole point: an analytics run this morning saturated the database for hours.
//
//   export/day=YYYY-MM-DD/videos.parquet          slim columns only, + a precomputed is_longform
//   export/day=YYYY-MM-DD/video_scores.parquet    the current stored score per video
//   export/day=YYYY-MM-DD/view_snapshots.parquet  the daily truth table (never thinned, so never
//                                                 in the raw-readings archive)
//
// One dated folder per run, so a harness result can be tied to the corpus it was computed on and
// an old run stays reproducible. The reader unions them by name and the newest day wins on a
// re-run of the same day (the key is overwritten).
//
// `videos` is 1.16 M rows over a 1.7 GB heap, so it is read in keyset batches on the primary key
// with a real statement_timeout, one batch at a time, and the job refuses to start while anything
// else heavy is running. It is a nightly, Nice-10, LowPriorityIO job for exactly that reason.
//
// Usage:
//   npx tsx scripts/export-tables.ts                      # all three, today's date
//   npx tsx scripts/export-tables.ts --tables videos      # one table
//   npx tsx scripts/export-tables.ts --limit 20000        # a sample, for a daytime smoke test
//   npx tsx scripts/export-tables.ts --dry-run
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { makeTimedPool } from '../lib/admin/db';
import { r2Config, MISSING_CREDENTIALS, putObject } from '../lib/readings/archive';
import { utcDay } from '../lib/readings/retention';
import { longformSql } from '../lib/scoring/longform';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const arg = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const dry = has('--dry-run') || has('--dry');
const day = arg('--day') ?? utcDay(Date.now());
const limit = Number(arg('--limit') ?? 0) || Infinity;
const BATCH = Number(arg('--batch') ?? 0) || 25_000;
const only = (arg('--tables') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
/**
 * Restrict the export to one channel's videos. This is how a SCOPED corpus is built for the
 * old-path/new-path diff (scripts/verify-parquet-harness.ts): a complete, tiny world that both
 * engines can be asked identical questions about, without exporting 1.16 M rows to do it.
 * A scoped export is written under its own day key so it can never be mistaken for the corpus.
 */
const scopeChannel = arg('--channel');
const daySuffix = scopeChannel ? `${day}-channel-${scopeChannel}` : Number.isFinite(limit) ? `${day}-sample-${limit}` : day;

const cfg = r2Config();
if (!cfg && !dry) { console.error(MISSING_CREDENTIALS); process.exit(1); }

const pool = makeTimedPool({
  connectionString: process.env.DATABASE_URL, max: 1,
  timeoutMs: Number(arg('--timeout-ms') ?? 300_000),
});
const q = async <T = any>(sql: string, params: any[] = []): Promise<T[]> => (await pool.query(sql, params)).rows as T[];

export const EXPORT_KEY = (d: string, table: string) => `export/day=${d}/${table}.parquet`;

/* eslint-disable @typescript-eslint/no-explicit-any */
const pq = async () => (await import('parquetjs-lite')) as any;

/**
 * What each table exports, and how it is walked.
 *
 * The videos column list is deliberately SHORT. `description` averages 1,061 bytes a row and
 * `metadata` 750 — 88 % of the table's tuple width — and no harness query reads either. Exporting
 * them would turn a 70 MB parquet into a 2 GB one for nothing.
 */
const TABLES: Record<string, {
  schema: Record<string, any>;
  cursor: string;
  sql: (cursor: string) => string;
  row: (r: any) => Record<string, unknown>;
}> = {
  videos: {
    schema: {
      id: { type: 'UTF8' },
      channel_id: { type: 'UTF8', optional: true },
      channel_name: { type: 'UTF8', optional: true },
      title: { type: 'UTF8', optional: true },
      published_at: { type: 'INT64', optional: true },
      view_count: { type: 'INT64', optional: true },
      duration: { type: 'UTF8', optional: true },
      is_short: { type: 'BOOLEAN', optional: true },
      is_institutional: { type: 'BOOLEAN', optional: true },
      privacy_status: { type: 'UTF8', optional: true },
      shorts_checked_at: { type: 'INT64', optional: true },
      format_type: { type: 'UTF8', optional: true },
      topic_niche: { type: 'UTF8', optional: true },
      // Precomputed here, with lib/scoring/longform.ts longformSql() itself, because DuckDB has
      // neither `duration::interval` nor `~`. One definition of long-form, evaluated in Postgres.
      is_longform: { type: 'BOOLEAN', optional: true },
    },
    cursor: 'id',
    sql: () => `select id, channel_id, channel_name, title, published_at, view_count, duration,
                       is_short, is_institutional, privacy_status, shorts_checked_at,
                       format_type, topic_niche, ${longformSql('videos')} as is_longform
                  from videos where id > $1 ${scopeChannel ? `and channel_id = '${scopeChannel}'` : ''}
                 order by id limit $2`,
    row: (r) => ({ ...r, published_at: t(r.published_at), shorts_checked_at: t(r.shorts_checked_at),
                   view_count: n(r.view_count) }),
  },
  video_scores: {
    schema: {
      video_id: { type: 'UTF8' }, channel_id: { type: 'UTF8', optional: true },
      model_version: { type: 'UTF8', optional: true }, scored_at: { type: 'INT64', optional: true },
      snapshot_day: { type: 'DOUBLE', optional: true }, views: { type: 'INT64', optional: true },
      q: { type: 'DOUBLE', optional: true }, est30: { type: 'DOUBLE', optional: true },
      baseline: { type: 'DOUBLE', optional: true }, n_baseline: { type: 'INT64', optional: true },
      score: { type: 'DOUBLE', optional: true }, same_age_ratio: { type: 'DOUBLE', optional: true },
      n_same_age: { type: 'INT64', optional: true }, confidence: { type: 'UTF8', optional: true },
      age_days: { type: 'DOUBLE', optional: true }, typical_at_age: { type: 'DOUBLE', optional: true },
      n_typical: { type: 'INT64', optional: true }, typical_neff: { type: 'DOUBLE', optional: true },
      typical_measured_share: { type: 'DOUBLE', optional: true },
      projection: { type: 'DOUBLE', optional: true }, projection_horizon: { type: 'DOUBLE', optional: true },
      typical_kind: { type: 'UTF8', optional: true }, typical_anchor_age: { type: 'DOUBLE', optional: true },
    },
    cursor: 'video_id',
    sql: () => `select video_id, channel_id, model_version, scored_at, snapshot_day, views, q, est30,
                       baseline, n_baseline, score, same_age_ratio, n_same_age, confidence, age_days,
                       typical_at_age, n_typical, typical_neff, typical_measured_share, projection,
                       projection_horizon, typical_kind, typical_anchor_age
                  from video_scores where video_id > $1 ${scopeChannel ? `and channel_id = '${scopeChannel}'` : ''}
                 order by video_id limit $2`,
    row: (r) => ({ ...r, scored_at: t(r.scored_at), views: n(r.views), n_baseline: n(r.n_baseline),
                   n_same_age: n(r.n_same_age), n_typical: n(r.n_typical) }),
  },
  view_snapshots: {
    schema: {
      video_id: { type: 'UTF8' }, snapshot_date: { type: 'UTF8' },
      view_count: { type: 'INT64', optional: true }, like_count: { type: 'INT64', optional: true },
      comment_count: { type: 'INT64', optional: true },
      days_since_published: { type: 'INT64', optional: true },
      created_at: { type: 'INT64', optional: true },
    },
    // Keyset on the primary key's leading column, so each batch is a bounded index walk rather
    // than an OFFSET that re-reads everything before it.
    cursor: 'video_id',
    sql: () => `select s.video_id, s.snapshot_date::text as snapshot_date, s.view_count, s.like_count,
                       s.comment_count, s.days_since_published, s.created_at
                  from view_snapshots s where s.video_id > $1
                   ${scopeChannel ? `and exists (select 1 from videos v where v.id = s.video_id and v.channel_id = '${scopeChannel}')` : ''}
                 order by s.video_id, s.snapshot_date limit $2`,
    row: (r) => ({ ...r, view_count: n(r.view_count), like_count: n(r.like_count),
                   comment_count: n(r.comment_count), days_since_published: n(r.days_since_published),
                   created_at: t(r.created_at) }),
  },
};

function t(v: unknown): number | null {
  if (v == null) return null;
  const d = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isFinite(d) ? d : null;
}
function n(v: unknown): number | null {
  if (v == null) return null;
  const x = Number(v);
  return Number.isFinite(x) ? Math.round(x) : null;
}

async function busyReason(): Promise<string | null> {
  const rows = await q<{ n: string }>(
    `select count(*)::text as n from pg_stat_activity
      where state = 'active' and now() - query_start > interval '2 minutes'
        and query not ilike '%pg_stat_activity%'`);
  return Number(rows[0]?.n ?? 0) > 0 ? `${rows[0].n} query(s) have been running over two minutes` : null;
}

async function exportTable(name: string): Promise<{ rows: number; bytes: number } | null> {
  const spec = TABLES[name];
  if (!spec) throw new Error(`unknown table: ${name}`);
  const lib = await pq();
  const P = lib.ParquetSchema ?? lib.default?.ParquetSchema;
  const W = lib.ParquetWriter ?? lib.default?.ParquetWriter;
  const file = path.join(os.tmpdir(), `export-${name}-${randomUUID()}.parquet`);
  const writer = await W.openFile(new P(spec.schema), file, { compression: 'SNAPPY' });
  let cursor = '';
  let rows = 0;
  try {
    for (;;) {
      const take = Math.min(BATCH, limit - rows);
      if (take <= 0) break;
      const batch = await q(spec.sql(cursor), [cursor, take]);
      if (!batch.length) break;
      for (const r of batch) await writer.appendRow(spec.row(r));
      rows += batch.length;
      cursor = String(batch[batch.length - 1][spec.cursor]);
      if (rows % (BATCH * 8) === 0) console.log(`  ${name}: ${rows.toLocaleString()} rows`);
      if (batch.length < take) break;
    }
  } finally {
    await writer.close();
  }
  const buf = await fs.readFile(file);
  await fs.rm(file, { force: true });
  if (!dry && cfg) await putObject(cfg, EXPORT_KEY(daySuffix, name), buf, 'application/vnd.apache.parquet');
  return { rows, bytes: buf.length };
}

const busy = await busyReason();
if (busy && !dry && !has('--force')) { console.error(`refusing to run: ${busy} (--force to override, only for a small supervised run)`); await pool.end(); process.exit(2); }

const wanted = only.length ? only : Object.keys(TABLES);
console.log(`table export day=${daySuffix}: ${wanted.join(', ')}${dry ? ' [dry run]' : ''}`);
for (const name of wanted) {
  const t0 = Date.now();
  const res = await exportTable(name);
  console.log(`${name}: ${res!.rows.toLocaleString()} rows, ${(res!.bytes / 1e6).toFixed(1)} MB -> ${EXPORT_KEY(daySuffix, name)} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
await pool.end();
