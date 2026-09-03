// Serves archived thumbnail versions from R2 at the edge and accepts uploads from the watcher.
//   GET  /{videoId}_v{n}.jpg           -> image (cached at the edge for a year; objects are immutable)
//   Avatar keys are NOT immutable (a channel changes its avatar and we overwrite the same key),
//   so they get a one-day edge cache instead of a year.
//   PUT  /{videoId}_v{n}.jpg           -> store (requires header x-upload-secret: UPLOAD_SECRET)
//   HEAD /{videoId}_v{n}.jpg           -> 200/404 without body
//   avatars/{channelId}.jpg           -> same three verbs; a copy of a channel's YouTube avatar,
//                                        served only when the hotlinked original fails
export interface Env { THUMBS: R2Bucket; UPLOAD_SECRET: string }

const KEY = /^(?:[A-Za-z0-9_-]{6,20}_v\d{1,4}|avatars\/UC[A-Za-z0-9_-]{22})\.jpg$/;

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const key = url.pathname.slice(1);
    if (!KEY.test(key)) return new Response('not found', { status: 404 });

    if (req.method === 'PUT') {
      if (req.headers.get('x-upload-secret') !== env.UPLOAD_SECRET) return new Response('forbidden', { status: 403 });
      const body = await req.arrayBuffer();
      if (body.byteLength < 200 || body.byteLength > 2_000_000) return new Response('bad size', { status: 400 });
      await env.THUMBS.put(key, body, { httpMetadata: { contentType: 'image/jpeg' } });
      return new Response('ok', { status: 201 });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('method', { status: 405 });

    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: 'GET' });
    const hit = await cache.match(cacheKey);
    if (hit) return req.method === 'HEAD' ? new Response(null, { status: 200, headers: hit.headers }) : hit;

    const obj = await env.THUMBS.get(key);
    if (!obj) return new Response('not found', { status: 404, headers: { 'cache-control': 'public, max-age=60' } });
    const headers = new Headers({
      'content-type': 'image/jpeg',
      'cache-control': key.startsWith('avatars/') ? 'public, max-age=86400' : 'public, max-age=31536000, immutable',
      'access-control-allow-origin': '*',
      etag: obj.httpEtag,
    });
    if (req.method === 'HEAD') return new Response(null, { status: 200, headers });
    const res = new Response(obj.body, { status: 200, headers });
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  },
} satisfies ExportedHandler<Env>;
