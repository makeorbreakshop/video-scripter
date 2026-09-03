import {
  DEFAULT_BACKFILL_DAYS,
  DEFAULT_BATCH_SIZE,
  SEMANTIC_BACKFILL_MODEL_VERSION,
  coverageBandSql,
  eligibleWhere,
  parseBackfillArgs,
  shouldUseFinalPath,
  targetStatusSql,
} from './backfill';
import fs from 'fs';
import path from 'path';

describe('semantic scoring backfill helpers', () => {
  it('defaults to dry-run and the bounded 365-day semantic repair window', () => {
    expect(parseBackfillArgs([])).toEqual({
      write: false,
      days: DEFAULT_BACKFILL_DAYS,
      minAgeDays: 0,
      limit: null,
      batchSize: DEFAULT_BATCH_SIZE,
      modelVersion: SEMANTIC_BACKFILL_MODEL_VERSION,
      paramsVersion: 'v3.0',
      sleepMs: 400,
      force: false,
      checkpoint: 'tmp/semantic-score-backfill-state.json',
    });
  });

  it('parses write, bounded batch, limit, version, and pacing flags', () => {
    expect(parseBackfillArgs([
      '--write',
      '--days', '180',
      '--min-age-days', '60',
      '--limit', '2500',
      '--batch-size', '1000',
      '--model-version', 'v-test',
      '--params-version', 'v-source',
      '--sleep', '50',
      '--checkpoint', 'tmp/custom.json',
      '--force',
    ])).toMatchObject({
      write: true,
      days: 180,
      minAgeDays: 60,
      limit: 2500,
      batchSize: 1000,
      modelVersion: 'v-test',
      paramsVersion: 'v-source',
      sleepMs: 50,
      checkpoint: 'tmp/custom.json',
      force: true,
    });
  });

  it('rejects batch sizes above the direct-Postgres id batch ceiling', () => {
    expect(() => parseBackfillArgs(['--batch-size', '5001'])).toThrow(/between 1 and 5000/);
    expect(() => parseBackfillArgs(['--days', '-1'])).toThrow(/non-negative integer/);
  });

  it('builds the indexed eligibility predicate used by dry-runs and writes', () => {
    const sql = eligibleWhere('v');
    expect(sql).toContain("v.published_at >= now() - ($1::int * interval '1 day')");
    expect(sql).toContain("v.published_at <= now() - ($2::int * interval '1 day')");
    expect(sql).toContain('shorts_checked_at is null');
    expect(sql).toContain("coalesce(v.duration, '') <> 'P0D'");
    expect(sql).toContain("coalesce(v.privacy_status,'public') = 'public'");
    expect(sql).toContain('coalesce(v.view_count,0) > 0');
  });

  it('keeps coverage and target-status reporting deterministic', () => {
    expect(coverageBandSql('v')).toContain("'0-30d'");
    expect(coverageBandSql('v')).toContain("'181-365d'");
    expect(targetStatusSql('s')).toContain("'missing_score'");
    expect(targetStatusSql('s')).toContain('s.model_version <> $3');
  });

  it('uses final scoring once observed counts are mature enough for day-30 scoring', () => {
    expect(shouldUseFinalPath(29.99)).toBe(false);
    expect(shouldUseFinalPath(30)).toBe(true);
    expect(shouldUseFinalPath(180)).toBe(true);
  });

  it('keeps the semantic backfill off the metered Supabase REST path', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../scripts/semantic/backfill-scores.ts'), 'utf8');
    expect(src).not.toMatch(/@supabase\/supabase-js/);
    expect(src).not.toMatch(/\.supabase\.co\/rest/);
    expect(src).not.toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(src).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(src).toMatch(/from 'pg'/);
  });
});
