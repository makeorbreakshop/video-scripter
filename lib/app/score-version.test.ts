import { scoreReadVersion, scoreParamsQuery } from './score-version';
import { MODEL_VERSION } from '../scoring/core';

describe('scoreReadVersion', () => {
  test('defaults to the shipped MODEL_VERSION', () => {
    expect(scoreReadVersion({} as NodeJS.ProcessEnv)).toBe(MODEL_VERSION);
  });

  test('SCORE_READ_VERSION overrides it -- the rollback hatch', () => {
    expect(scoreReadVersion({ SCORE_READ_VERSION: 'v4.0' } as any)).toBe('v4.0');
  });

  test('blank or whitespace-only is not an override', () => {
    expect(scoreReadVersion({ SCORE_READ_VERSION: '' } as any)).toBe(MODEL_VERSION);
    expect(scoreReadVersion({ SCORE_READ_VERSION: '   ' } as any)).toBe(MODEL_VERSION);
  });

  test('the value is trimmed, so a stray newline in the env does not miss every row', () => {
    expect(scoreReadVersion({ SCORE_READ_VERSION: ' v3.0\n' } as any)).toBe('v3.0');
  });
});

describe('scoreParamsQuery', () => {
  test('binds the version rather than interpolating it', () => {
    const [sql, params] = scoreParamsQuery(`params->'mult' as mult`, {} as any);
    expect(sql).toContain(`params->'mult' as mult`);
    expect(sql).toContain('model_version = $1');
    expect(sql).not.toContain(MODEL_VERSION);
    expect(params).toEqual([MODEL_VERSION]);
  });

  test('takes the latest fit for that version', () => {
    const [sql] = scoreParamsQuery('params', {} as any);
    expect(sql).toContain('order by fitted_at desc limit 1');
  });
});
