// The scoring harness's database: DuckDB over the R2 parquet archive, with zero production reads.
//
// WHY DUCKDB, not parquetjs-lite.
//
// parquetjs-lite is already in the tree and it reads these files — but it reads them one row at
// a time into JavaScript objects. A benchmark run touches 8.2 M rss_samples rows across 14 day
// partitions; decoding that row-by-row in JS is minutes of CPU and the whole day in memory.
// DuckDB reads the same files columnar, pushes the predicate into the parquet reader, and spills
// to disk instead of to the heap. It is also SQL, which is the point: the harness queries can be
// moved across almost verbatim instead of being rewritten as array code, and a rewrite is exactly
// where "identical results" would quietly stop being true.
//
// THE MEMORY LIMIT IS NOT OPTIONAL. An analytics engine given a whole machine will take it — the
// flight tracker's ClickHouse went down twice that way. Every connection here is opened with a
// hard `memory_limit`, a bounded `threads`, and a `temp_directory` so an aggregate that does not
// fit SPILLS rather than dies. The defaults are deliberately small; a caller that needs more has
// to say so.
//
// WHY A LOCAL CACHE. R2 is an object store, not a filesystem: DuckDB's httpfs would re-range-read
// the same footers on every query. Day partitions are immutable once written (lib/readings/
// archive.ts), so the cache never needs invalidating — only extending with newer days.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { r2Config, getObject, listObjects, type R2Config } from './archive';

export interface ParquetSourceOptions {
  /** Where the parquet files are cached. Defaults to $TMPDIR/video-scripter-parquet. */
  cacheDir?: string;
  /** Hard ceiling on DuckDB's heap. */
  memoryLimit?: string;
  threads?: number;
  /** Ceiling on what a spilling query may write to disk. */
  tempLimit?: string;
  cfg?: R2Config | null;
  /** Skip the R2 sync and use whatever is already cached. */
  offline?: boolean;
  /**
   * Which nightly table export to read. Defaults to the newest plain `day=YYYY-MM-DD` present.
   * A SCOPED export (scripts/export-tables.ts --channel / --limit) writes a suffixed day so it
   * can never be picked up as the corpus by accident; name it here to read one deliberately.
   */
  exportDay?: string;
  verbose?: boolean;
}

export const PARQUET_DEFAULTS = {
  memoryLimit: '2GB',
  threads: 4,
  tempLimit: '8GB',
} as const;

export function defaultCacheDir(): string {
  return process.env.PARQUET_CACHE_DIR || path.join(os.tmpdir(), 'video-scripter-parquet');
}

/** Every prefix the harness reads. `export/` is written by scripts/export-tables.ts. */
export const PARQUET_PREFIXES = ['readings/', 'history/', 'export/'] as const;

/**
 * Pull anything new from R2 into the local cache. An object already present at the same byte
 * size is skipped — day partitions are immutable, so size equality is identity here.
 */
export async function syncCache(opts: ParquetSourceOptions = {}): Promise<{ downloaded: number; bytes: number; cached: number }> {
  const cfg = opts.cfg ?? r2Config();
  const dir = opts.cacheDir ?? defaultCacheDir();
  if (!cfg) throw new Error('parquet source: no R2 credentials');
  let downloaded = 0, bytes = 0, cached = 0;
  for (const prefix of PARQUET_PREFIXES) {
    for (const obj of await listObjects(cfg, prefix)) {
      if (!obj.key.endsWith('.parquet')) continue;
      const local = path.join(dir, obj.key);
      const have = await fs.stat(local).catch(() => null);
      if (have && have.size === obj.size) { cached++; continue; }
      const buf = await getObject(cfg, obj.key);
      if (!buf) continue;
      await fs.mkdir(path.dirname(local), { recursive: true });
      await fs.writeFile(local, buf);
      downloaded++; bytes += buf.length;
      if (opts.verbose) console.log(`  ↓ ${obj.key} (${(buf.length / 1e6).toFixed(1)} MB)`);
    }
  }
  return { downloaded, bytes, cached };
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The views the harness queries by their Postgres names, so a query can move across as text.
 *
 * `union_by_name` is what makes the archive forward-compatible: a day written before
 * model_eligible/conflicted existed simply has NULL there, and the coalesce below restores the
 * pre-flag behaviour (everything eligible, nothing conflicted) rather than dropping the day.
 */
async function viewSql(conn: any, dir: string, exportDay: string): Promise<Record<string, string>> {
  const readings = (source: string) =>
    `read_parquet('${path.join(dir, 'readings', `source=${source}`, 'day=*', '*.parquet')}', union_by_name = true, hive_partitioning = false)`;
  const exported = (name: string) =>
    `read_parquet('${path.join(dir, 'export', `day=${exportDay}`, `${name}.parquet`)}', union_by_name = true, hive_partitioning = false)`;

  /**
   * Which columns a set of parquet files actually has.
   *
   * The archive gained model_eligible / conflicted / received_at on 2026-09-08; days written
   * before that do not have them, and `union_by_name` does not invent them. Referencing a
   * missing column would either fail to bind or — worse — silently resolve to the output alias
   * of the same name and produce a column that is its own definition. So the projection is built
   * from what is there, and an absent flag becomes the literal that reproduces the pre-flag
   * behaviour: everything eligible, nothing conflicted.
   */
  const columnsOf = async (from: string): Promise<Set<string>> => {
    try {
      const res = await conn.runAndReadAll(`describe select * from ${from}`);
      return new Set(res.getRowObjects().map((r: any) => String(r.column_name)));
    } catch { return new Set<string>(); }
  };
  const rssCols = await columnsOf(readings('rss'));
  const flag = (name: string, fallback: string) =>
    rssCols.has(name) ? `coalesce(r.${name === 'at' ? '"at"' : name}, ${fallback})` : fallback;

  return {
    // Raw readings: `at` is epoch millis in the archive (parquetjs-lite cannot write
    // TIMESTAMP_MILLIS on Node 22+), so every view converts it back.
    rss_samples: `select r.video_id,
        to_timestamp(r."at" / 1000.0) as "at",
        r.views, r.likes, ${rssCols.has('time_basis') ? 'r.time_basis' : 'null'} as time_basis,
        ${flag('model_eligible', 'true')}  as model_eligible,
        ${flag('conflicted',     'false')} as conflicted,
        ${rssCols.has('received_at')
          // Null-preserving on purpose. Postgres has NULL received_at for the older rss rows, and
          // OBSERVATION_RECORDS_SQL / benchmark.records both read it with greatest(at, received_at):
          // substituting `at` for a NULL would silently move those readings' wall clock. Measured
          // 2026-09-08: 570 of 1,630 rows differed on nothing but this.
          ? 'to_timestamp(r.received_at / 1000.0)'
          // A day archived before the column existed simply does not know; null says so.
          : 'null::timestamptz'} as received_at
      from ${readings('rss')} r`,
    view_samples: `select r.video_id,
        to_timestamp(r."at" / 1000.0) as sampled_at,
        r.views as view_count, r.likes as like_count
      from ${readings('api')} r`,
    // The daily truth table. Not part of the raw-readings archive (it is a serving table, never
    // thinned), so it comes from the nightly table export. Times are epoch millis there too, and
    // a harness query that says `v.published_at` must get a timestamp, not a number, or
    // `extract(epoch from …)` quietly means something else.
    view_snapshots: `select video_id, snapshot_date::date as snapshot_date, view_count, like_count,
        comment_count, days_since_published, to_timestamp(created_at / 1000.0) as created_at
      from ${exported('view_snapshots')}`,
    videos: `select id, channel_id, channel_name, title,
        to_timestamp(published_at / 1000.0) as published_at,
        view_count, duration, is_short, is_institutional, privacy_status,
        to_timestamp(shorts_checked_at / 1000.0) as shorts_checked_at,
        format_type, topic_niche, is_longform
      from ${exported('videos')}`,
    video_scores: `select * replace (to_timestamp(scored_at / 1000.0) as scored_at)
      from ${exported('video_scores')}`,
    video_score_history: `select id, video_id, channel_id, model_version,
        to_timestamp(scored_at / 1000.0) as scored_at, age_days, views, score, same_age_ratio,
        typical_at_age, n_typical, typical_measured_share, projection, projection_horizon,
        est30, baseline, n_baseline, confidence, extra
      from read_parquet('${path.join(dir, 'history', 'day=*', '*.parquet')}', union_by_name = true, hive_partitioning = false)`,
  };
}

export interface ParquetSource {
  /** A drop-in for the harness's own q(): same signature, same row shape. */
  q<T = any>(sql: string, params?: any[]): Promise<T[]>;
  close(): Promise<void>;
  readonly cacheDir: string;
}

/**
 * Parameters are substituted client-side rather than bound.
 *
 * This is an offline analytics database over files we wrote ourselves, fed by the harness's own
 * literals — there is no untrusted input anywhere in it. Binding would mean translating Postgres
 * array parameters (`= any($1)`, which every chunked harness query uses) into DuckDB's list
 * binding, and a translation layer is exactly the kind of thing that makes two runs disagree.
 * Values are still quoted properly; a string containing a quote cannot end the literal.
 */
export function substitute(sql: string, params: readonly any[] = []): string {
  const lit = (v: any): string => {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (v instanceof Date) return `timestamp '${v.toISOString()}'`;
    if (Array.isArray(v)) return `[${v.map(lit).join(', ')}]`;
    return `'${String(v).replace(/'/g, "''")}'`;
  };
  // $10 before $1, so the longer placeholder is not eaten by the shorter one.
  return sql.replace(/\$(\d+)/g, (_m, d) => lit(params[Number(d) - 1]));
}

/**
 * The three Postgres spellings the harness uses that DuckDB does not share.
 *
 * 1. `x = any($1)` — every chunked query in the harness. DuckDB spells it `in (select unnest(…))`.
 * 2. `collate "C"` — a Postgres collation, and a no-op in DuckDB, which is byte-wise already.
 * 3. lib/scoring/longform.ts longformSql(), whose body casts an ISO-8601 duration to an interval
 *    and regex-matches it. Neither exists in DuckDB, so the export precomputes the answer as an
 *    `is_longform` column and the predicate is rewritten to read it. This is a REWRITE OF THE
 *    SAME RULE, not a second definition: scripts/export-tables.ts computes the column with
 *    longformSql() itself, so there is still exactly one place that decides what long-form means.
 */
export function toDuckDialect(sql: string): string {
  return quoteAt(sql
    .replace(/\(coalesce\((\w+)\.is_short,\s*false\)\s*=\s*false[\s\S]*?<=\s*\d+\)\)/gi, '($1.is_longform)')
    .replace(/=\s*any\s*\(\s*(\[[^\]]*\])(::[a-z_]+\[\])?\s*\)/gi, ' in (select unnest($1))')
    .replace(/collate\s+"C"/gi, '')
    .replace(/::text\[\]/gi, ''));
}

/**
 * `at` is a reserved word in DuckDB (AT TIME ZONE), so an UNQUALIFIED `at` in a select list is a
 * parse error — `select video_id, at, views from rss_samples` does not compile, and that is the
 * shape of lib/scoring/observations.ts OBSERVATION_RECORDS_SQL and of half the harness queries.
 * Qualified (`x.at`) and already-quoted (`"at"`) forms are fine, so only the bare one is touched.
 *
 * String literals are stepped over rather than rewritten: an `at` inside 'response-date-estimate'
 * or a regex literal is data, not an identifier.
 */
export function quoteAt(sql: string): string {
  return sql
    .split(/('(?:[^']|'')*')/)                          // odd indices are string literals
    .map((part, i) => (i % 2 === 1 ? part
      : part.replace(/(^|[^\w."])at(?![\w"])(?!\s+time\s+zone)/gi, '$1"at"')))
    .join('');
}

/**
 * The newest UNSUFFIXED export day in the cache. Suffixed days are scoped or sampled exports
 * (see ParquetSourceOptions.exportDay) and are never the default corpus.
 */
export async function newestExportDay(dir: string): Promise<string> {
  const entries = await fs.readdir(path.join(dir, 'export')).catch(() => [] as string[]);
  const days = entries
    .map((e) => /^day=(\d{4}-\d{2}-\d{2})$/.exec(e)?.[1])
    .filter((d): d is string => !!d)
    .sort();
  return days[days.length - 1] ?? '0000-00-00';
}

export async function openParquetSource(opts: ParquetSourceOptions = {}): Promise<ParquetSource> {
  const dir = opts.cacheDir ?? defaultCacheDir();
  await fs.mkdir(dir, { recursive: true });
  if (!opts.offline) {
    const synced = await syncCache({ ...opts, cacheDir: dir });
    if (opts.verbose) console.log(`parquet cache: ${synced.cached} cached, ${synced.downloaded} downloaded (${(synced.bytes / 1e6).toFixed(1)} MB) in ${dir}`);
  }
  const { DuckDBInstance } = await import('@duckdb/node-api');
  const tmp = path.join(dir, '.duckdb-spill');
  await fs.mkdir(tmp, { recursive: true });
  const instance = await DuckDBInstance.create(':memory:', {
    // The hard ceiling. See the header: an analytics engine given a whole machine will take it.
    memory_limit: opts.memoryLimit ?? PARQUET_DEFAULTS.memoryLimit,
    threads: String(opts.threads ?? PARQUET_DEFAULTS.threads),
    temp_directory: tmp,
    max_temp_directory_size: opts.tempLimit ?? PARQUET_DEFAULTS.tempLimit,
    preserve_insertion_order: 'false',
  });
  const conn = await instance.connect();
  // UTC, explicitly.
  //
  // `snapshot_date::timestamptz` means midnight in the SESSION time zone. Postgres runs in UTC;
  // DuckDB defaults to the machine's, so on a laptop in New York every `snapshot_date::timestamptz
  // + interval '12 hours'` came out four hours from where Postgres put it, and every snapshot row
  // silently disagreed. Measured: 131 of 131 rows of the backtest's snapshot query differed on
  // nothing but this.
  await conn.run(`set TimeZone = 'UTC'`);
  const exportDay = opts.exportDay ?? await newestExportDay(dir);
  if (opts.verbose) console.log(`parquet corpus: export day=${exportDay}`);
  for (const [name, body] of Object.entries(await viewSql(conn, dir, exportDay))) {
    // A prefix with no files yet must not take the whole source down: the view is created only
    // when something is there to read, and a query against a missing one says so by name.
    try { await conn.run(`create or replace view ${name} as ${body}`); }
    catch (e) {
      if (opts.verbose) console.warn(`[parquet] no data for ${name}: ${(e as Error).message.split('\n')[0]}`);
    }
  }
  return {
    cacheDir: dir,
    async q<T = any>(sql: string, params: any[] = []): Promise<T[]> {
      const text = toDuckDialect(substitute(sql, params));
      const res = await conn.runAndReadAll(text);
      // DuckDB gives BIGINT back as BigInt and DECIMAL as a struct; pg gives strings. The
      // harness's Number(...) coercions accept either, but a BigInt would poison arithmetic
      // silently, so it is normalised here rather than at fifty call sites.
      return res.getRowObjects().map((row: any) => {
        const out: any = {};
        for (const [k, v] of Object.entries(row)) {
          out[k] = typeof v === 'bigint' ? Number(v)
            : v && typeof v === 'object' && 'micros' in (v as any) ? new Date(Number((v as any).micros) / 1000)
            : v;
        }
        return out as T;
      });
    },
    async close() { conn.closeSync?.(); instance.closeSync?.(); },
  };
}
