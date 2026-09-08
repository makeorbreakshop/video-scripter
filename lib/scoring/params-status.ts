// Which `score_params` row is live.
//
// Until 2026-09-08 the answer was "the newest row for this model_version", so the nightly 04:15
// `--fit` was a model change that went live on commit with nothing standing between it and the
// app. `score_params.status` (sql/score-params-status.sql) splits fitting from promoting:
// a fit writes a CANDIDATE, scripts/weekly-refit.ts runs the gates, and only a pass moves a row
// to ACTIVE. Everything that scores or renders reads the newest ACTIVE row.
//
// Every reader goes through here so there is one place to look when asking "what is live".

export type ParamsStatus = 'candidate' | 'active' | 'rejected';

/**
 * `select <cols> from score_params ...` for the newest row of `model_version` in `status`.
 * The version is `$1`; nothing else is parameterised, so `cols` and `extraWhere` must be
 * literals from the caller, never user input.
 */
export function paramsQuery(
  cols: string,
  opts: { status?: ParamsStatus; extraWhere?: string } = {}
): string {
  const status = opts.status ?? 'active';
  const extra = opts.extraWhere ? ` and ${opts.extraWhere}` : '';
  return `select ${cols} from score_params
           where model_version = $1 and status = '${status}'${extra}
           order by fitted_at desc limit 1`;
}

/** The live row for a version: what the scorer and the app read. */
export const activeParamsQuery = (cols: string, extraWhere?: string) =>
  paramsQuery(cols, { status: 'active', extraWhere });

/** A row by primary key, for a gate judging one specific candidate. */
export const paramsByIdQuery = (cols: string) => `select ${cols} from score_params where id = $1`;
