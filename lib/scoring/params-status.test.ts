import { paramsQuery, activeParamsQuery, paramsByIdQuery } from './params-status';
import { scoreParamsQuery, scoreReadVersion } from '../app/score-version';

const flat = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();

describe('active params resolution', () => {
  it('reads the newest ACTIVE row, not merely the newest row', () => {
    // The whole point of sql/score-params-status.sql: a nightly --fit writes a candidate, and
    // "latest wins" would put it live untested the moment it commits.
    expect(flat(activeParamsQuery('params')))
      .toBe("select params from score_params where model_version = $1 and status = 'active' order by fitted_at desc limit 1");
  });

  it('can be pointed at candidates and rejects, for a gate that has to read one', () => {
    expect(flat(paramsQuery('params', { status: 'candidate' }))).toContain("status = 'candidate'");
    expect(flat(paramsQuery('params', { status: 'rejected' }))).toContain("status = 'rejected'");
  });

  it('keeps the caller projection and any extra predicate', () => {
    const sql = flat(activeParamsQuery("params->'mult' as mult", "params ? 'bands'"));
    expect(sql).toContain("select params->'mult' as mult from score_params");
    expect(sql).toContain("and status = 'active' and params ? 'bands'");
  });

  it('addresses one row by id for a candidate under gate', () => {
    expect(flat(paramsByIdQuery('params'))).toBe('select params from score_params where id = $1');
  });
});

describe('the app read path', () => {
  it('is the active query, bound to the read version', () => {
    const [sql, args] = scoreParamsQuery('params', { SCORE_READ_VERSION: 'v9.9' } as unknown as NodeJS.ProcessEnv);
    expect(flat(sql)).toBe(flat(activeParamsQuery('params')));
    expect(args).toEqual(['v9.9']);
  });

  it('falls back to the shipped model version', () => {
    expect(scoreReadVersion({} as unknown as NodeJS.ProcessEnv)).toBe(require('./core').MODEL_VERSION);
  });
});
