// WebSub (PubSubHubbub) lease policy — pure functions + SQL text, no I/O.
// https://developers.google.com/youtube/v3/guides/push_notifications
//
// WHY THIS EXISTS: WebSub is the sanctioned, zero-quota upload detector. RSS polling of
// youtube.com/feeds/videos.xml is disallowed by YouTube's robots.txt and is now a daily
// fallback only (lib/rss/poll-policy.ts). The lease table is what tells the poller which
// channels have a live push subscription and may therefore be polled once a day instead of
// every 15 minutes.
//
// MEASURED 2026-09-06, and this is the root cause of the "968 failures":
// pubsubhubbub.appspot.com answers most POST /subscribe requests by stalling for exactly 20.2 s
// and then returning "503 Transient error; please try again later". An accepted subscribe comes
// back 202 in ~0.3 s. Sampling 12 random corpus channels one at a time gave 1 x 202 and
// 11 x 503 — an 8% acceptance rate, statistically the same as the 57/1,025 (5.6%) the 2026-09-01
// 10-wide run got. The rate does not move with concurrency, callback, topic form, hub.verify
// mode, HTTP version or User-Agent (all varied and measured), so it is neither our request shape
// nor our pacing: the hub's own synchronous topic fetch is timing out. GET on the same host is a
// fast 200 throughout.
//
// What follows from that: acceptance is a coin flip, so the only thing that converges is
// REPEATED PASSES. Concurrency is safe to raise (the failure is a hub-side stall, not a rate
// limit — a limiter would say 429), in-request retries are not worth their 20 s each, and every
// attempt's status and body is written to websub_leases so the next pass can see what happened.

export const WEBSUB = {
  hubUrl: 'https://pubsubhubbub.appspot.com/subscribe',
  /** ~9.5 days. The hub caps YouTube feed leases around 10 days. */
  leaseSeconds: 828_000,
  /** Re-subscribe anything expiring inside two days. */
  renewWithinSec: 2 * 86_400,
  /** A failure costs a 20 s stall, so width is what makes a pass finish. Measured harmless. */
  concurrency: 25,
  batchPauseMs: 250,
  /** In-request retries buy nothing against a coin flip; the pass loop is the retry. */
  maxAttempts: 1,
  retryBaseMs: 5_000,
  retryCapMs: 180_000,
  requestTimeoutMs: 25_000,
  /** Passes per run over whatever is still unaccepted. 8% per pass => ~30% of a cold corpus. */
  passes: 4,
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
    -- A 202 is only an acknowledgement; the hub's verification GET follows within minutes.
    -- Don't re-ask inside that window or a multi-pass run just repeats itself.
    and (l.last_hub_status is distinct from 202 or l.last_subscribed_at < now() - interval '1 hour')
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
