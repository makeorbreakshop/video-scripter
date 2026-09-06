// WebSub (PubSubHubbub) lease policy — pure functions + SQL text, no I/O.
// https://developers.google.com/youtube/v3/guides/push_notifications
//
// WHY THIS EXISTS: WebSub is the sanctioned, zero-quota upload detector. RSS polling of
// youtube.com/feeds/videos.xml is disallowed by YouTube's robots.txt and is now a daily
// fallback only (lib/rss/poll-policy.ts). The lease table is what tells the poller which
// channels have a live push subscription and may therefore be polled once a day instead of
// every 15 minutes.
//
// MEASURED 2026-09-06: pubsubhubbub.appspot.com answers POST /subscribe with
// "503 Transient error; please try again later" + Retry-After: 120 once the source IP has been
// throttled, and it answers EVERY subsequent POST that way regardless of callback or verify
// mode. The 2026-09-01 run (10-wide, 300 ms between batches ≈ 33 req/s) got 57 accepted and
// 968 x 503 with no retry and no stderr capture in the LaunchAgent — that is the whole of the
// "968 failures". Hence: slow pacing, Retry-After-aware retries, and the status + body of every
// attempt written to websub_leases.

export const WEBSUB = {
  hubUrl: 'https://pubsubhubbub.appspot.com/subscribe',
  /** ~9.5 days. The hub caps YouTube feed leases around 10 days. */
  leaseSeconds: 828_000,
  /** Re-subscribe anything expiring inside two days. */
  renewWithinSec: 2 * 86_400,
  /** Pacing: 5 in flight, 2 s between groups => 2.5 req/s sustained. */
  concurrency: 5,
  batchPauseMs: 2_000,
  maxAttempts: 4,
  retryBaseMs: 5_000,
  retryCapMs: 180_000,
  requestTimeoutMs: 20_000,
} as const;

export function topicUrl(channelId: string): string {
  return `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${channelId}`;
}

export function subscribeParams(opts: {
  channelId: string;
  callback: string;
  secret?: string | null;
  mode?: 'subscribe' | 'unsubscribe';
  leaseSeconds?: number;
}): URLSearchParams {
  const p = new URLSearchParams({
    'hub.mode': opts.mode ?? 'subscribe',
    'hub.topic': topicUrl(opts.channelId),
    'hub.callback': opts.callback,
    'hub.lease_seconds': String(opts.leaseSeconds ?? WEBSUB.leaseSeconds),
    'hub.verify': 'async',
  });
  if (opts.secret) p.set('hub.secret', opts.secret);
  return p;
}

export const isHubAccepted = (status: number): boolean => status === 202 || status === 204;

/** 429/5xx (notably the hub's throttling 503) is worth retrying; a 4xx is our own mistake. */
export const isRetryableHubStatus = (status: number): boolean => status === 429 || status >= 500;

export function retryDelayMs(attempt: number, retryAfterSec?: number | null): number {
  if (retryAfterSec && retryAfterSec > 0) return Math.min(retryAfterSec * 1000, WEBSUB.retryCapMs);
  return Math.min(WEBSUB.retryBaseMs * 2 ** (attempt - 1), WEBSUB.retryCapMs);
}

export interface LeaseRow {
  channel_id?: string;
  lease_expires_at: Date | string | null;
  last_verified_at: Date | string | null;
}

/** A lease counts as live only when the hub confirmed it AND it has not run out. */
export function leaseIsVerified(lease: LeaseRow | null | undefined, now: Date = new Date()): boolean {
  if (!lease || !lease.last_verified_at || !lease.lease_expires_at) return false;
  return new Date(lease.lease_expires_at).getTime() > now.getTime();
}

/** Channels needing a (re)subscribe: never subscribed, never verified, or expiring soon. */
export function dueLeaseIds<T extends LeaseRow & { channel_id: string }>(
  rows: T[],
  now: Date = new Date(),
  withinSec: number = WEBSUB.renewWithinSec
): string[] {
  const cutoff = now.getTime() + withinSec * 1000;
  return rows
    .filter((r) => !r.last_verified_at || !r.lease_expires_at || new Date(r.lease_expires_at).getTime() <= cutoff)
    .map((r) => r.channel_id);
}

export function batches<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size) as T[]);
  return out;
}

/**
 * Every channel that has videos, left-joined to its lease. channel_rss_state is the corpus's
 * channel list (6,423 rows on 2026-09-06), already maintained by the RSS seed. $1 = limit.
 */
export const DUE_LEASES_SQL = `select c.channel_id, l.lease_expires_at, l.last_verified_at, l.failures
     from channel_rss_state c
     left join websub_leases l on l.channel_id = c.channel_id
    where l.channel_id is null
       or l.last_verified_at is null
       or l.lease_expires_at is null
       or l.lease_expires_at <= now() + interval '${WEBSUB.renewWithinSec} seconds'
    order by coalesce(l.lease_expires_at, 'epoch'::timestamptz), c.channel_id
    limit $1`;

/**
 * One row per attempt. last_verified_at / last_push_at belong to the receiver and are never
 * overwritten here — a re-subscribe must not erase the evidence that pushes are arriving.
 */
export const LEASE_UPSERT_SQL = `insert into websub_leases
     (channel_id, topic, callback, last_subscribed_at, last_hub_status, last_hub_body, failures)
   select * from unnest($1::text[], $2::text[], $3::text[], $4::timestamptz[], $5::int[], $6::text[], $7::int[])
   on conflict (channel_id) do update
     set topic = excluded.topic,
         callback = excluded.callback,
         last_subscribed_at = excluded.last_subscribed_at,
         last_hub_status = excluded.last_hub_status,
         last_hub_body = excluded.last_hub_body,
         failures = case when excluded.last_hub_status in (202, 204) then 0
                         else websub_leases.failures + 1 end,
         updated_at = now()`;
