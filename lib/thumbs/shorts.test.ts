import { verdictFromResponse } from './shorts';

describe('verdictFromResponse (youtube.com/shorts/<id>)', () => {
  test('200 means YouTube serves it as a Short', () => {
    expect(verdictFromResponse(200, null)).toBe('short');
  });
  test('a redirect to /watch means it is a regular video', () => {
    expect(verdictFromResponse(303, 'https://www.youtube.com/watch?v=Po_Dh7WLgmM')).toBe('long');
    expect(verdictFromResponse(302, '/watch?v=abc&feature=shorts_redirect')).toBe('long');
  });
  test('only an explicit 404/410 means the video is gone', () => {
    expect(verdictFromResponse(404, null)).toBe('gone');
    expect(verdictFromResponse(410, null)).toBe('gone');
  });

  // 2026-09-04: this used to return 'gone', and 'gone' stamped shorts_checked_at while leaving
  // is_short alone — so a consent interstitial or a /sorry/ bounce froze the old CDN detector's
  // guess (~10 % false positives) as permanent truth that no later run could re-check.
  test('a redirect anywhere else is UNKNOWN, not gone — it is not evidence of a deletion', () => {
    expect(verdictFromResponse(303, 'https://www.youtube.com/')).toBe('unknown');
    expect(verdictFromResponse(302, 'https://consent.youtube.com/m?continue=...')).toBe('unknown');
    expect(verdictFromResponse(302, 'https://www.google.com/sorry/index')).toBe('unknown');
    expect(verdictFromResponse(307, null)).toBe('unknown');
  });
  test('rate limits and server errors are unknown, never a verdict', () => {
    expect(verdictFromResponse(429, null)).toBe('unknown');
    expect(verdictFromResponse(503, null)).toBe('unknown');
  });
});

// Guard: the writer half of the same bug. A 'gone' verdict must not stamp shorts_checked_at,
// because lib/scoring/longform.ts treats a stamped row as verified and never re-checks it.
describe('verify-shorts writes', () => {
  const src = require('fs').readFileSync(
    require('path').resolve(__dirname, '../../scripts/verify-shorts.ts'), 'utf8');

  test("no 'gone' branch stamps shorts_checked_at", () => {
    expect(src).not.toMatch(/v === 'gone'[\s\S]{0,120}?shorts_checked_at\s*=\s*now\(\)/);
    expect(src).toContain("if (v !== 'gone')");
  });
});
