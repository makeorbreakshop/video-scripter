// Per-key token bucket. In-memory on purpose: one bucket per process is enough to stop a runaway
// script, and it costs no round trip on the hot path. It is not a distributed limit — several
// serverless instances each get their own bucket, so the effective ceiling is per instance.
export const RATE_LIMIT = 60;          // requests
export const RATE_WINDOW_MS = 60_000;  // per minute

export interface Bucket { tokens: number; updatedAt: number }

export interface Decision {
  allowed: boolean;
  bucket: Bucket;
  remaining: number;
  /** Seconds the caller should wait before retrying; 0 when allowed. */
  retryAfter: number;
}

/**
 * Pure: given a bucket and the current time, decide and return the next bucket. Tokens refill
 * continuously rather than in step resets, so a client is never told to wait a whole window for
 * the one token that just became available.
 */
export function take(
  bucket: Bucket | undefined,
  now: number,
  limit = RATE_LIMIT,
  windowMs = RATE_WINDOW_MS
): Decision {
  const refillPerMs = limit / windowMs;
  const elapsed = bucket ? Math.max(0, now - bucket.updatedAt) : 0;
  const tokens = Math.min(limit, (bucket ? bucket.tokens : limit) + elapsed * refillPerMs);

  if (tokens >= 1) {
    const next = { tokens: tokens - 1, updatedAt: now };
    return { allowed: true, bucket: next, remaining: Math.floor(next.tokens), retryAfter: 0 };
  }
  return {
    allowed: false,
    bucket: { tokens, updatedAt: now },
    remaining: 0,
    retryAfter: Math.max(1, Math.ceil((1 - tokens) / refillPerMs / 1000)),
  };
}

const buckets = new Map<string, Bucket>();
// The map would otherwise grow one entry per key forever in a long-lived process.
const MAX_TRACKED = 10_000;

export function consume(id: string, now = Date.now()): Decision {
  const decision = take(buckets.get(id), now, RATE_LIMIT, RATE_WINDOW_MS);
  if (buckets.size > MAX_TRACKED && !buckets.has(id)) {
    for (const [k, b] of buckets) if (now - b.updatedAt > RATE_WINDOW_MS) buckets.delete(k);
  }
  buckets.set(id, decision.bucket);
  return decision;
}

/** Test seam. */
export function resetBuckets() { buckets.clear(); }
