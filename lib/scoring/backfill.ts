import { longformSql } from './longform';
export const SEMANTIC_BACKFILL_MODEL_VERSION = 'v3.1-semantic-backfill-2026-09';
export const DEFAULT_BACKFILL_DAYS = 365;
export const DEFAULT_MIN_AGE_DAYS = 0;
export const DEFAULT_BATCH_SIZE = 500;
export const MAX_BATCH_SIZE = 5000;

export interface BackfillOptions {
  write: boolean;
  days: number;
  minAgeDays: number;
  limit: number | null;
  batchSize: number;
  modelVersion: string;
  paramsVersion: string;
  sleepMs: number;
  force: boolean;
  checkpoint: string;
}

export function parseBackfillArgs(argv: string[]): BackfillOptions {
  const value = (name: string): string | null => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
  };

  const intArg = (name: string, fallback: number): number => {
    const raw = value(name);
    if (raw == null) return fallback;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`${name} must be a non-negative integer`);
    }
    return parsed;
  };

  const batchSize = intArg('--batch-size', DEFAULT_BATCH_SIZE);
  if (batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error(`--batch-size must be between 1 and ${MAX_BATCH_SIZE}`);
  }

  return {
    write: argv.includes('--write'),
    days: intArg('--days', DEFAULT_BACKFILL_DAYS),
    minAgeDays: intArg('--min-age-days', DEFAULT_MIN_AGE_DAYS),
    limit: value('--limit') == null ? null : intArg('--limit', 0),
    batchSize,
    modelVersion: value('--model-version') ?? SEMANTIC_BACKFILL_MODEL_VERSION,
    paramsVersion: value('--params-version') ?? 'v3.0',
    sleepMs: intArg('--sleep', 400),
    force: argv.includes('--force'),
    checkpoint: value('--checkpoint') ?? 'tmp/semantic-score-backfill-state.json',
  };
}

export function eligibleWhere(alias = 'v'): string {
  return `${alias}.published_at >= now() - ($1::int * interval '1 day')
        and ${alias}.published_at <= now() - ($2::int * interval '1 day')
        and ${longformSql(alias)}
        and coalesce(${alias}.privacy_status,'public') = 'public'
        and coalesce(${alias}.view_count,0) > 0`;
}

export function coverageBandSql(alias = 'v'): string {
  return `case
    when ${alias}.published_at >= now() - interval '30 days' then '0-30d'
    when ${alias}.published_at >= now() - interval '60 days' then '31-60d'
    when ${alias}.published_at >= now() - interval '180 days' then '61-180d'
    else '181-365d'
  end`;
}

export function targetStatusSql(scoreAlias = 's'): string {
  return `case
    when ${scoreAlias}.video_id is null then 'missing_score'
    when ${scoreAlias}.model_version <> $3 then 'other_version'
    when ${scoreAlias}.score is null then 'null_score'
    else 'covered'
  end`;
}

export function shouldUseFinalPath(ageDays: number): boolean {
  return ageDays >= 30;
}
