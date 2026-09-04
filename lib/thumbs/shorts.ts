// Is this video a Short? Ask YouTube, zero Data API quota:
//   HEAD https://www.youtube.com/shorts/<id>  -> 200 when it IS a Short,
//                                             -> 303 to /watch?v=<id> when it is not.
// This is YouTube's own routing decision, so it is authoritative and survives the 3-minute
// Shorts duration change.
//
// The earlier signal here (the CDN's vertical thumbnail variant oardefault.jpg, 200 only for
// Shorts) was checked against the redirect on 2026-09-03: it MISSED 16 of 40 confirmed Shorts
// (vertical news clips, a video titled "#shorts") and wrongly flagged ~10% of what it called
// Shorts (a 16:9 volcano experiment, a 16:9 interview). Do not reintroduce it as a filter.
// Pixel-measuring pillarbox bars on hqdefault was also tried and is defeated by dark thumbnails.

export type ShortsVerdict = 'short' | 'long' | 'gone' | 'unknown';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

/** Pure mapping from the /shorts/<id> response to a verdict, so it can be unit-tested. */
export function verdictFromResponse(status: number, location: string | null): ShortsVerdict {
  if (status === 200) return 'short';
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

export async function shortsVerdict(videoId: string, attempts = 3): Promise<ShortsVerdict> {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`https://www.youtube.com/shorts/${videoId}`, {
        method: 'HEAD', redirect: 'manual', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(8000),
      });
      const v = verdictFromResponse(r.status, r.headers.get('location'));
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
