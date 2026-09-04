import fs from 'node:fs';
import path from 'node:path';
import { decideSamplingSource, type SamplingCandidate } from './sampling-freshness';

const M = 60_000;
const H = 60 * M;
const now = new Date('2026-09-04T16:00:00.000Z');

function candidate(overrides: Partial<SamplingCandidate> = {}): SamplingCandidate {
  return {
    intervalMinutes: 15,
    lastViews: 100,
    lastApiAt: new Date(now.getTime() - H),
    rssAt: new Date(now.getTime() - 5 * M),
    rssViews: 120,
    ...overrides,
  };
}

describe('sampling freshness coordination', () => {
  test('keeps sub-15-minute launch and packaging bursts on the API', () => {
    expect(decideSamplingSource(candidate({ intervalMinutes: 5 }), now).source).toBe('api');
  });

  test('lets a recent non-decreasing RSS observation satisfy a routine deadline', () => {
    expect(decideSamplingSource(candidate(), now)).toEqual({ source: 'rss', reason: 'fresh_rss' });
  });

  test('uses the smaller of the ladder interval and the 20-minute RSS ceiling', () => {
    expect(decideSamplingSource(candidate({ intervalMinutes: 30, rssAt: new Date(now.getTime() - 19 * M) }), now).source).toBe('rss');
    expect(decideSamplingSource(candidate({ intervalMinutes: 30, rssAt: new Date(now.getTime() - 21 * M) }), now).source).toBe('api');
    expect(decideSamplingSource(candidate({ intervalMinutes: 15, rssAt: new Date(now.getTime() - 16 * M) }), now).source).toBe('api');
  });

  test('forces an API crosscheck at least every six hours', () => {
    expect(decideSamplingSource(candidate({ lastApiAt: new Date(now.getTime() - 6 * H) }), now)).toEqual({ source: 'api', reason: 'api_crosscheck_due' });
    expect(decideSamplingSource(candidate({ lastApiAt: null }), now).source).toBe('api');
  });

  test('rejects missing, invalid, and future RSS observations', () => {
    expect(decideSamplingSource(candidate({ rssAt: null }), now).source).toBe('api');
    expect(decideSamplingSource(candidate({ rssAt: new Date('invalid') }), now).source).toBe('api');
    expect(decideSamplingSource(candidate({ rssAt: new Date(now.getTime() + M) }), now).source).toBe('api');
    expect(decideSamplingSource(candidate({ rssViews: null }), now).source).toBe('api');
  });

  test('a lower RSS counter than the last API count forces API validation', () => {
    expect(decideSamplingSource(candidate({ rssViews: 99 }), now)).toEqual({ source: 'api', reason: 'rss_declined' });
  });

  test('RSS must be newer than the API observation it replaces', () => {
    const lastApiAt = new Date(now.getTime() - 5 * M);
    expect(decideSamplingSource(candidate({ lastApiAt, rssAt: lastApiAt }), now)).toEqual({ source: 'api', reason: 'rss_not_newer' });
  });
});

describe('launch scheduler exact optimistic tokens', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'scripts/launch-track.ts'), 'utf8');

  test('keeps PostgreSQL microseconds as text through every schedule CAS', () => {
    expect(source).toMatch(/next_check::text as next_check/i);
    expect(source).toMatch(/updated_at::text as updated_at/i);
    expect(source).toContain('s.next_check = x.prior_next_check and s.updated_at = x.prior_updated_at');
    expect(source).toContain('next_check = $6 and updated_at = $7');
  });

  test('reports successful and raced RSS schedule updates from rowCount', () => {
    expect(source).toMatch(/rssAdvanced\s*\+=\s*advanced\.rowCount/);
    expect(source).toContain('rssSatisfied.length - rssAdvanced');
  });
});
