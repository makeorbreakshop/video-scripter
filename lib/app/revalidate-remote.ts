// The pipeline scripts (nightly ingest, scoring, baselines, the thumbnail/title watchers)
// run as plain node processes, where revalidateTag does nothing — there is no Next runtime
// to hold the cache. They ask the running app to do it over HTTP instead.
//
// Entirely best effort: no APP_BASE_URL or REVALIDATE_SECRET means skip silently (that is
// the normal state for a local one-off run), and any error is swallowed. The worst case is
// a page serving data up to its TTL old.
const TIMEOUT_MS = 5_000;

export async function revalidateRemote(payload: {
  channels?: string[];
  videos?: { id: string; channelId?: string | null }[];
}): Promise<void> {
  const base = process.env.APP_BASE_URL;
  const secret = process.env.REVALIDATE_SECRET;
  if (!base || !secret) return;
  if (!payload.channels?.length && !payload.videos?.length) return;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    await fetch(`${base.replace(/\/$/, '')}/api/app/revalidate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-revalidate-secret': secret },
      body: JSON.stringify(payload),
      signal: ctl.signal,
    });
  } catch {
    // best effort
  } finally {
    clearTimeout(timer);
  }
}
