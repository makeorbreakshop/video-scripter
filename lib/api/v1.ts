// Public API v1 plumbing: bearer-key auth, per-key rate limiting, and the JSON envelope every
// route returns. Routes under app/api/v1 own their auth (middleware leaves /api/v1 public).
import { NextResponse } from 'next/server';
import { q, one } from '../admin/db';
import { hashKey } from '../app/api-keys';
import { consume } from './rate-limit';

export interface ApiCaller { keyId: string; userId: string }

/** Parse `Authorization: Bearer <key>`; also accepts `X-Api-Key` for curl convenience. */
export function bearerFrom(req: Request): string | null {
  const auth = req.headers.get('authorization');
  if (auth) {
    const m = /^Bearer\s+(\S+)$/i.exec(auth.trim());
    if (m) return m[1];
    return null;
  }
  return req.headers.get('x-api-key');
}

export function jsonError(status: number, code: string, message: string, headers?: Record<string, string>) {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}

// last_used_at is a "is this key still in use?" signal, not an access log. Writing it on every
// request would double the write volume of the whole API for no extra information.
const LAST_USED_THROTTLE_MS = 60_000;
const lastUsedWrites = new Map<string, number>();

async function touchKey(keyId: string) {
  const now = Date.now();
  if (now - (lastUsedWrites.get(keyId) || 0) < LAST_USED_THROTTLE_MS) return;
  lastUsedWrites.set(keyId, now);
  await q(`update api_keys set last_used_at = now() where id = $1`, [keyId]).catch((e) => {
    console.error('api_keys last_used_at update failed', keyId, e instanceof Error ? e.message : e);
  });
}

export async function authenticate(req: Request): Promise<ApiCaller | NextResponse> {
  const presented = bearerFrom(req);
  if (!presented) {
    return jsonError(401, 'unauthorized', 'Missing bearer token. Send Authorization: Bearer <key>.', {
      'www-authenticate': 'Bearer',
    });
  }
  const row = await one<{ id: string; user_id: string }>(
    `select id, user_id from api_keys where key_hash = $1 and revoked_at is null`,
    [hashKey(presented)]
  );
  if (!row) return jsonError(401, 'unauthorized', 'Unknown or revoked API key.', { 'www-authenticate': 'Bearer' });

  const decision = consume(row.id);
  if (!decision.allowed) {
    return jsonError(429, 'rate_limited', 'Rate limit exceeded: 60 requests per minute per key.', {
      'retry-after': String(decision.retryAfter),
      'x-ratelimit-limit': '60',
      'x-ratelimit-remaining': '0',
    });
  }
  await touchKey(row.id);
  return { keyId: row.id, userId: row.user_id };
}

/** Wraps a route handler with auth, rate limiting, and uniform error handling. */
export function withApiKey(
  handler: (req: Request, caller: ApiCaller, ctx: any) => Promise<NextResponse>
) {
  return async (req: Request, ctx: any): Promise<NextResponse> => {
    try {
      const caller = await authenticate(req);
      if (caller instanceof NextResponse) return caller;
      return await handler(req, caller, ctx);
    } catch (e) {
      console.error('api/v1 error', req.url, e instanceof Error ? e.stack : e);
      return jsonError(500, 'internal_error', 'Something went wrong handling this request.');
    }
  };
}

export function intParam(url: URL, name: string, fallback: number, max: number): number {
  const raw = url.searchParams.get(name);
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

/** `?types=upload,outlier` — repeated params work too. */
export function listParam(url: URL, name: string): string[] | null {
  const all = url.searchParams.getAll(name).flatMap((v) => v.split(','));
  const cleaned = all.map((v) => v.trim()).filter(Boolean);
  return cleaned.length ? cleaned : null;
}

/** One score shape everywhere (same as /videos/:id). */
export function scoreShape(r: any) {
  return {
    model_version: r.model_version, scored_at: r.scored_at, snapshot_day: r.snapshot_day, views: r.score_views ?? r.views,
    est30: r.est30, baseline: r.baseline, n_baseline: r.n_baseline, score: r.score,
    same_age_ratio: r.same_age_ratio, n_same_age: r.n_same_age, confidence: r.confidence,
  };
}

