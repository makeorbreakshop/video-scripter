// One switch, four harnesses: where does a scoring run read its data from?
//
//   --source postgres   (default) exactly what it did before — the production database
//   --source parquet    DuckDB over the R2 archive, ZERO production reads
//
// The seam is the `q()` every harness already had. Swapping it, rather than rewriting the
// queries, is what makes "identical results" checkable: the same SQL text runs, over the same
// rows, in a different engine (lib/readings/parquet-source.ts translates the three spellings
// DuckDB does not share).
//
// score_params is the deliberate exception. It is one small indexed row, it is the thing a
// refit is JUDGING, and a candidate written thirty seconds ago must not be read from last
// night's export. `pgq` is for that, and only that.

import type { Pool } from 'pg';
import { openParquetSource, type ParquetSourceOptions, type ParquetSource } from './parquet-source';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type QueryFn = (sql: string, params?: any[]) => Promise<any[]>;

export interface HarnessSource {
  /** Readings and corpus metadata. Parquet when asked for, Postgres otherwise. */
  q: QueryFn;
  /** Always Postgres: score_params, model_evals, pg_stat_activity. Small and always live. */
  pgq: QueryFn;
  label: 'postgres' | 'parquet';
  close(): Promise<void>;
}

export function sourceFromArgv(argv: readonly string[] = process.argv): 'postgres' | 'parquet' {
  const i = argv.indexOf('--source');
  const v = (i >= 0 ? argv[i + 1] : undefined) ?? process.env.HARNESS_SOURCE ?? 'postgres';
  if (v !== 'postgres' && v !== 'parquet') throw new Error(`--source must be postgres or parquet, got ${v}`);
  return v;
}

export async function harnessSource(
  pool: Pool, argv: readonly string[] = process.argv, opts: ParquetSourceOptions = {}
): Promise<HarnessSource> {
  const pgq: QueryFn = async (sql, params) => (await pool.query(sql, params)).rows as any[];
  const label = sourceFromArgv(argv);
  if (label === 'postgres') return { q: pgq, pgq, label, close: async () => {} };

  const i = argv.indexOf('--memory-limit');
  const src: ParquetSource = await openParquetSource({
    verbose: true,
    offline: argv.includes('--offline'),
    memoryLimit: (i >= 0 ? argv[i + 1] : undefined) ?? opts.memoryLimit,
    ...opts,
  });
  return {
    q: (sql, params) => src.q(sql, params),
    pgq,
    label,
    close: () => src.close(),
  };
}
