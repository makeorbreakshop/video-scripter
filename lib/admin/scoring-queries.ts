// Reads for /admin/scoring. Plain selects against two tables that scripts/weekly-refit.ts and
// scripts/scorecard-refresh.ts have already computed — the page does no arithmetic.
import { q } from './db';

export interface EvalRow {
  id: number;
  run_at: string;
  model_version: string;
  candidate_params_id: number | null;
  verdict: string;
  worst_cell: string | null;
  notes: string | null;
  gates: Record<string, { status?: string; headline?: string }> | null;
}

export async function recentEvals(limit = 12): Promise<EvalRow[]> {
  return q<EvalRow>(
    `select id, run_at, model_version, candidate_params_id, verdict, worst_cell, notes, gates
       from model_evals order by run_at desc limit $1`,
    [limit]
  );
}

export interface ScorecardRow {
  computed_at: string;
  source: string;
  dimension: string;
  bucket: string;
  metrics: Record<string, number | null>;
}

/** The newest computed_at per source, and every cell in it. */
export async function latestScorecard(): Promise<ScorecardRow[]> {
  return q<ScorecardRow>(
    `with newest as (
       select source, max(computed_at) as computed_at from scorecard group by source)
     select s.computed_at, s.source, s.dimension, s.bucket, s.metrics
       from scorecard s join newest n on n.source = s.source and n.computed_at = s.computed_at
      order by s.source, s.dimension, s.id`
  );
}

/** The live fit and the last few candidates, so the page can say what is actually scoring. */
export interface ParamsRow {
  id: number; model_version: string; fitted_at: string; n_videos: number;
  status: string; status_at: string | null; status_note: string | null; has_bands: boolean;
}

export async function recentParams(limit = 8): Promise<ParamsRow[]> {
  return q<ParamsRow>(
    `select id, model_version, fitted_at, n_videos, status, status_at, status_note,
            (params ? 'bands') as has_bands
       from score_params order by fitted_at desc limit $1`,
    [limit]
  );
}
