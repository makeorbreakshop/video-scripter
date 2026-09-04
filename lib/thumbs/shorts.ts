// Is this video a Short? Ask YouTube, zero Data API quota:
//   GET https://www.youtube.com/shorts/<id>, redirect: 'manual'
//     303 -> /watch?v=<id>                 => NOT a Short (YouTube's own routing decision)
//     200 AND the page is the Shorts page  => a Short
//     200 without that proof               => UNKNOWN, never stamped
// This survives the 3-minute Shorts duration change, unlike any duration rule.
//
// WHAT THE 200s TURNED OUT TO BE (measured 2026-09-04, ET) — TWO SEPARATE FAULTS:
//
// (a) A DATABASE TRIGGER, not this file, is the main cause of the mislabelled band.
//     `trigger_set_video_is_short` (BEFORE INSERT OR UPDATE OF duration, title, description on
//     `videos`) calls `is_youtube_short(duration, title, description)`, which returns TRUE for
//     ANY duration <= 180 s, or any title/description matching #short(s)/#youtubeshort(s). It
//     overwrites whatever the application decided from YouTube's own routing. So every 61-180 s
//     LONG-FORM video inserted by any ingest path lands as is_short = true while the app writes
//     shorts_checked_at = now() beside it — verified-and-wrong, and longformSql never looks again.
//     Re-checked live: of the 2,000 most recently stamped rows in that band, 1,369 (68 %) are
//     303 -> /watch, and among rows inserted in the last hours it is ~100 %. Fix in
//     sql/2026-09-04-drop-is-short-trigger.sql (NOT applied — needs Brandon).
//
// (b) The old 200-means-short rule really did stamp some rows from transient 200s. Random 60 from
//     the whole 61-180 s band stamped since 09-03 (67,780 rows): 60/60 returned 200 WITH the
//     Shorts-page marker below. Random 60 from the 2026-09-04 00:40-05:30Z window: 47 marked 200,
//     13 x 303 -> /watch. Those false 200s could NOT be reproduced afterwards — HEAD and GET agree
//     on every control (5IsVft2evQ8, dQw4w9WgXcQ, jNQXAC9IVRw) and 30 concurrent unspaced requests
//     to six known-long ids returned 303 -> /watch 30/30 — so they left no signature to detect
//     after the fact. The defence has to be positive proof: a 200 must LOOK like the Shorts page.
//
// The marker: YouTube's iOS smart-banner meta, at byte ~1,392 of every Shorts page --
//   <meta name="apple-itunes-app" content="app-id=544007664, app-argument=
//        https://www.youtube.com/shorts/<id>?referring_app=...">
// It is id-anchored (a generic consent/sorry/interstitial page cannot contain it), and it is early
// enough that the body read is capped at 96 KB instead of the ~1.5 MB a full Shorts page weighs.
// Note: the string "consent.youtube.com" is NOT a usable consent-page marker -- it appears in the
// config blob of ordinary pages too. Presence of the id-anchored marker is the whole test.
//
// The earlier signal here (the CDN's vertical thumbnail variant oardefault.jpg, 200 only for
// Shorts) was checked against the redirect on 2026-09-03: it MISSED 16 of 40 confirmed Shorts
// (vertical news clips, a video titled "#shorts") and wrongly flagged ~10% of what it called
// Shorts (a 16:9 volcano experiment, a 16:9 interview). Do not reintroduce it as a filter.
// Pixel-measuring pillarbox bars on hqdefault was also tried and is defeated by dark thumbnails.

export type ShortsVerdict = 'short' | 'long' | 'gone' | 'unknown';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

/** How much of the response body we are willing to read to find the marker. */
export const BODY_READ_CAP_BYTES = 96 * 1024;

/**
 * Does this (capped) page head prove we are on the Shorts player page for THIS video?
 * Anchored on the video id so no generic interstitial can satisfy it.
 */
export function hasShortsPageMarker(bodyHead: string, videoId: string): boolean {
  if (!videoId) return false;
  return bodyHead.includes(`/shorts/${videoId}?referring_app=`)
    // Belt and braces: the canonical/og markers say the same thing, further down the page.
    || bodyHead.includes(`<link rel="canonical" href="https://www.youtube.com/shorts/${videoId}"`)
    || bodyHead.includes(`content="https://www.youtube.com/shorts/${videoId}"`);
}

/** Pure mapping from the /shorts/<id> response to a verdict, so it can be unit-tested. */
export function verdictFromResponse(
  status: number, location: string | null, bodyHead = '', videoId = ''
): ShortsVerdict {
  // A 200 is only a Short if the body proves it is the Shorts player page for this id.
  // Before 2026-09-04 every 200 was 'short'; see the header for what that cost.
  if (status === 200) return hasShortsPageMarker(bodyHead, videoId) ? 'short' : 'unknown';
  // A redirect to /watch?v= is YouTube saying "not a Short" — the authoritative answer.
  // ANY OTHER 3xx is not evidence of anything: a consent interstitial, /sorry/ rate-limiting, a
  // locale or region bounce, a login wall. Until 2026-09-04 those all returned 'gone', which
  // stamped shorts_checked_at and left is_short untouched — freezing whatever the old CDN
  // detector had guessed (it had ~10 % false positives) as permanent, unrecheckable truth.
  // They are 'unknown': try again later.
  if (status >= 300 && status < 400) return /\/watch\?v=/.test(location ?? '') ? 'long' : 'unknown';
  // Only an explicit not-found is a deletion.
  if (status === 404 || status === 410) return 'gone';
  return 'unknown'; // 429 / 5xx / network: try again later
}

/** Read at most BODY_READ_CAP_BYTES of the body, then abort the stream. */
async function readCapped(r: Response): Promise<string> {
  const body = r.body;
  // No stream to cap (a mocked/HTTP-1 body): fall back to text().
  if (!body || typeof (body as ReadableStream).getReader !== 'function') {
    return typeof r.text === 'function' ? await r.text().catch(() => '') : '';
  }
  const reader = body.getReader();
  const dec = new TextDecoder();
  let out = '', n = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.byteLength;
      out += dec.decode(value, { stream: true });
      if (n >= BODY_READ_CAP_BYTES) break;
    }
  } catch { /* partial body is fine — the marker is in the first 4 KB */ }
  await reader.cancel().catch(() => {});
  return out;
}

export async function shortsVerdict(videoId: string, attempts = 3): Promise<ShortsVerdict> {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`https://www.youtube.com/shorts/${videoId}`, {
        method: 'GET', redirect: 'manual', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(8000),
      });
      // Only a 200 needs a body; every redirect answer is already in the headers.
      const head = r.status === 200 ? await readCapped(r) : '';
      const v = verdictFromResponse(r.status, r.headers.get('location'), head, videoId);
      if (v !== 'unknown') return v;
    } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
  }
  return 'unknown';
}

/** true = Short, false = not a Short, null = could not tell (deleted, private, or YouTube unreachable). */
export async function isShortByRedirect(videoId: string): Promise<boolean | null> {
  const v = await shortsVerdict(videoId);
  return v === 'short' ? true : v === 'long' ? false : null;
}
