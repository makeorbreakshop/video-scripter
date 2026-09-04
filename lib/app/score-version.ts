// Which model version the APP reads.
//
// Two places used to hardcode `'v3.0'` when picking a `score_params` row (video-page.ts,
// admin/queries.ts). That was already wrong the moment MODEL_VERSION moved to v4, and under v5
// it would have had the video page drawing v3 growth curves under v5 scores.
//
// `video_scores` holds one row per video -- the latest write -- so the app reads the current row
// unfiltered and the flip to v5 is atomic with the rescore. What still needs a version is
// `score_params`, which has one row per fit per version. That is what this resolves.
//
// SCORE_READ_VERSION exists as an escape hatch: point the app back at a previous version's
// params without a deploy if a rescore has to be rolled back.
import { MODEL_VERSION } from '../scoring/core';

/** The model version the app should read params for. Env override, else the shipped model. */
export function scoreReadVersion(env: NodeJS.ProcessEnv = process.env): string {
  const v = env.SCORE_READ_VERSION?.trim();
  return v ? v : MODEL_VERSION;
}

/**
 * The single `score_params` read every app surface uses. `cols` is the projection, e.g.
 * `params->'mult' as mult`. Returns [sql, params] ready for a one()/q() call.
 */
export function scoreParamsQuery(
  cols: string,
  env: NodeJS.ProcessEnv = process.env
): [string, [string]] {
  return [
    `select ${cols} from score_params where model_version = $1 order by fitted_at desc limit 1`,
    [scoreReadVersion(env)],
  ];
}
