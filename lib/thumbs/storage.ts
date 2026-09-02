// Archived thumbnail bytes live in Cloudflare R2 behind the 'channelsmith-thumbs' Worker (workers/thumbs):
// zero-egress, edge-cached, immutable per (video, version). The local data/thumbnails folder on the watcher
// machine is a cache and the backfill source, not the source of truth for the deployed app.
//   THUMBS_BASE_URL       public base (Worker URL); images are served from `${base}/${videoId}_v${n}.jpg`
//   THUMBS_UPLOAD_SECRET  shared secret the Worker requires on PUT
export function thumbUrl(videoId: string, version: number) {
  const base = (process.env.NEXT_PUBLIC_THUMBS_BASE_URL || process.env.THUMBS_BASE_URL || '').replace(/\/$/, '');
  return base ? `${base}/${videoId}_v${version}.jpg` : null;
}

export async function uploadThumb(videoId: string, version: number, buf: Buffer): Promise<boolean> {
  const base = (process.env.THUMBS_BASE_URL || '').replace(/\/$/, '');
  const secret = process.env.THUMBS_UPLOAD_SECRET;
  if (!base || !secret) return false;
  const res = await fetch(`${base}/${videoId}_v${version}.jpg`, {
    method: 'PUT',
    headers: { 'x-upload-secret': secret, 'content-type': 'image/jpeg' },
    body: new Uint8Array(buf),
    signal: AbortSignal.timeout(20000),
  });
  return res.ok;
}

export async function thumbExists(videoId: string, version: number): Promise<boolean> {
  const base = (process.env.THUMBS_BASE_URL || '').replace(/\/$/, '');
  if (!base) return false;
  const res = await fetch(`${base}/${videoId}_v${version}.jpg`, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
  return res.ok;
}
