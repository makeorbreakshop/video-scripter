import { verdictFromResponse, hasShortsPageMarker } from './shorts';

// Fixture snippets taken from real /shorts/<id> responses on 2026-09-04 (bytes ~1,392 of the
// page; full pages are ~1.5 MB and are deliberately not committed).
const ID = 'L2gUhnTIJHE';
const SHORTS_HEAD =
  `<!DOCTYPE html><html lang="en"><head><meta name="apple-itunes-app" content="app-id=544007664,` +
  ` app-argument=https://www.youtube.com/shorts/${ID}?referring_app=com.apple.mobilesafari-smartbanner,` +
  ` affiliate-data=ct=smart_app_banner_polymer&amp;pt=9008"><script nonce="x">var ytcfg={};</script>`;
// A page that is a 200 but is not this video's Shorts page: no id-anchored marker anywhere.
const INTERSTITIAL_HEAD =
  `<!DOCTYPE html><html><head><title>Before you continue to YouTube</title>` +
  `<form action="https://consent.youtube.com/save"><input name="continue"></form>`;

describe('verdictFromResponse (youtube.com/shorts/<id>)', () => {
  // 2026-09-04: a bare 200 used to mean 'short'. In the 00:40-05:30Z backfill window ~22 % of the
  // 61-180 s rows it stamped that way are actually long-form (303 -> /watch when re-checked), and
  // the bad 200s left no header signature. So a 200 must PROVE it is this video's Shorts page.
  test('200 with the Shorts page marker for this id is a Short', () => {
    expect(verdictFromResponse(200, null, SHORTS_HEAD, ID)).toBe('short');
  });
  test('200 without the marker is unknown, never stamped', () => {
    expect(verdictFromResponse(200, null, INTERSTITIAL_HEAD, ID)).toBe('unknown');
    expect(verdictFromResponse(200, null, '', ID)).toBe('unknown');
    expect(verdictFromResponse(200, null)).toBe('unknown');
  });
  test("200 whose marker names a DIFFERENT video does not count", () => {
    expect(verdictFromResponse(200, null, SHORTS_HEAD, 'someOtherId')).toBe('unknown');
  });
  test('the marker test alone', () => {
    expect(hasShortsPageMarker(SHORTS_HEAD, ID)).toBe(true);
    expect(hasShortsPageMarker(INTERSTITIAL_HEAD, ID)).toBe(false);
    expect(hasShortsPageMarker(SHORTS_HEAD, '')).toBe(false);
    expect(hasShortsPageMarker(
      `<link rel="canonical" href="https://www.youtube.com/shorts/${ID}">`, ID)).toBe(true);
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

  // The whole point of the 2026-09-04 redesign: an 'unknown' must leave shorts_checked_at NULL so
  // the row comes back on a later run. Only 'short'/'long' may write.
  test("an 'unknown' verdict writes nothing", () => {
    expect(src).toContain("if (v === 'unknown')");
  });
});
