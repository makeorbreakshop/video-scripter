import { bearerFrom, intParam, listParam } from './v1';

const req = (headers: Record<string, string>) => new Request('https://x.test/api/v1/feed', { headers });

describe('bearerFrom', () => {
  it('reads Authorization: Bearer', () => {
    expect(bearerFrom(req({ authorization: 'Bearer cs_live_abc' }))).toBe('cs_live_abc');
    expect(bearerFrom(req({ authorization: 'bearer cs_live_abc' }))).toBe('cs_live_abc');
    expect(bearerFrom(req({ authorization: '  Bearer   cs_live_abc  ' }))).toBe('cs_live_abc');
  });

  it('rejects other auth schemes rather than treating them as a key', () => {
    expect(bearerFrom(req({ authorization: 'Basic abc' }))).toBeNull();
    expect(bearerFrom(req({ authorization: 'Bearer' }))).toBeNull();
  });

  it('falls back to X-Api-Key only when Authorization is absent', () => {
    expect(bearerFrom(req({ 'x-api-key': 'cs_live_abc' }))).toBe('cs_live_abc');
    expect(bearerFrom(req({ authorization: 'Basic x', 'x-api-key': 'cs_live_abc' }))).toBeNull();
  });

  it('is null with no headers at all', () => {
    expect(bearerFrom(req({}))).toBeNull();
  });
});

describe('query params', () => {
  const url = (qs: string) => new URL(`https://x.test/api/v1/feed${qs}`);

  it('clamps and defaults limits', () => {
    expect(intParam(url(''), 'limit', 50, 200)).toBe(50);
    expect(intParam(url('?limit=10'), 'limit', 50, 200)).toBe(10);
    expect(intParam(url('?limit=9999'), 'limit', 50, 200)).toBe(200);
    expect(intParam(url('?limit=0'), 'limit', 50, 200)).toBe(50);
    expect(intParam(url('?limit=-3'), 'limit', 50, 200)).toBe(50);
    expect(intParam(url('?limit=abc'), 'limit', 50, 200)).toBe(50);
  });

  it('accepts comma-separated and repeated list params', () => {
    expect(listParam(url('?types=upload,outlier'), 'types')).toEqual(['upload', 'outlier']);
    expect(listParam(url('?types=upload&types=outlier'), 'types')).toEqual(['upload', 'outlier']);
    expect(listParam(url('?types=upload,,'), 'types')).toEqual(['upload']);
    expect(listParam(url(''), 'types')).toBeNull();
    expect(listParam(url('?types='), 'types')).toBeNull();
  });
});
