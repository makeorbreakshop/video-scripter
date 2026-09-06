// WebSub receiver logic — pure, no I/O. The route (app/api/websub/route.ts) does the database
// work; everything decidable without a connection is decided here so it can be tested.
//
// Push notifications carry the same Atom entry shape as the channel feed, so the parsing and
// the "is this a new upload" rule are shared with lib/rss/poll-policy.ts rather than restated.
import crypto from 'crypto';
import { decodeEntities, isNewUpload } from '../rss/poll-policy';

export interface PushEntry {
  video_id: string;
  channel_id: string | null;
  title: string | null;
  published: string | null;
  updated: string | null;
  deleted: boolean;
}

// ---------------------------------------------------------------- verification

export interface VerificationResult {
  status: 200 | 404;
  body: string;
  channelId: string | null;
  leaseExpiresAt: Date | null;
}

export function channelIdFromTopic(topic: string | null): string | null {
  if (!topic) return null;
  return /[?&]channel_id=(UC[A-Za-z0-9_-]{22})/.exec(topic)?.[1] ?? null;
}

/**
 * The hub's GET handshake. Echo hub.challenge verbatim with 200 or the subscription is dropped.
 * A subscribe verification is also the ONLY moment the hub tells us the lease it granted.
 */
export function verificationResponse(params: URLSearchParams, now: Date = new Date()): VerificationResult {
  const challenge = params.get('hub.challenge');
  if (!challenge) return { status: 404, body: '', channelId: null, leaseExpiresAt: null };
  const channelId = channelIdFromTopic(params.get('hub.topic'));
  const lease = parseInt(params.get('hub.lease_seconds') || '0', 10);
  const subscribing = (params.get('hub.mode') ?? 'subscribe') === 'subscribe';
  return {
    status: 200,
    body: challenge,
    channelId,
    leaseExpiresAt: subscribing && lease > 0 ? new Date(now.getTime() + lease * 1000) : null,
  };
}

// ---------------------------------------------------------------- signature

/** X-Hub-Signature is "<alg>=<hex>". Constant-time compare; no secret configured means no check. */
export function verifySignature(body: string, header: string | null | undefined, secret: string): boolean {
  if (!secret) return true;
  if (!header) return false;
  const [alg, hex] = header.split('=', 2);
  if (!alg || !hex || !/^[0-9a-f]+$/i.test(hex)) return false;
  let expected: Buffer;
  try {
    expected = crypto.createHmac(alg.toLowerCase(), secret).update(body).digest();
  } catch {
    return false;
  }
  const got = Buffer.from(hex, 'hex');
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

// ---------------------------------------------------------------- parsing

const one = (block: string, name: string): string | null =>
  new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block)?.[1] ?? null;

export function parsePushEntries(xml: string): PushEntry[] {
  const out: PushEntry[] = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(xml)) !== null) {
    const b = m[1];
    const id = /<yt:videoId>([A-Za-z0-9_-]{6,20})<\/yt:videoId>/.exec(b)?.[1];
    if (!id) continue;
    const title = one(b, 'title');
    out.push({
      video_id: id,
      channel_id: /<yt:channelId>(UC[A-Za-z0-9_-]{22})<\/yt:channelId>/.exec(b)?.[1] ?? null,
      title: title == null ? null : decodeEntities(title.trim()),
      published: one(b, 'published'),
      updated: one(b, 'updated'),
      deleted: false,
    });
  }
  // Tombstones: YouTube sends <at:deleted-entry ref="yt:video:ID"> when a video goes away.
  const delRe = /<at:deleted-entry[^>]*\bref="yt:video:([A-Za-z0-9_-]{6,20})"/g;
  while ((m = delRe.exec(xml)) !== null) {
    out.push({ video_id: m[1], channel_id: null, title: null, published: null, updated: null, deleted: true });
  }
  return out;
}

// ---------------------------------------------------------------- plan

export interface KnownVideo { title: string | null; published_at: Date | string | null }

export interface PushPlan {
  queue: { ref: string; source_url: string }[];
  titleChanges: { video_id: string; from: string; to: string }[];
  woken: string[];
}

/**
 * What a push means, given what we already have.
 *
 * Idempotency: the hub re-delivers, and the touch_queue insert is ON CONFLICT DO NOTHING, but a
 * video already in `videos` is not a new upload at all — it is an edit — so it never re-enters
 * the queue. Only unknown ids published inside the RSS new-upload window are discovery.
 */
export function pushPlan(entries: PushEntry[], known: Map<string, KnownVideo>, now: Date = new Date()): PushPlan {
  const queue: PushPlan['queue'] = [];
  const titleChanges: PushPlan['titleChanges'] = [];
  const woken = new Set<string>();
  const seen = new Set<string>();
  for (const e of entries) {
    if (e.channel_id) woken.add(e.channel_id);
    if (e.deleted || seen.has(e.video_id)) continue;
    seen.add(e.video_id);
    const cur = known.get(e.video_id);
    if (!cur) {
      if (isNewUpload(e.published, now)) {
        queue.push({ ref: e.video_id, source_url: `websub:${e.channel_id ?? 'unknown'}` });
      }
      continue;
    }
    if (e.title && cur.title && e.title !== cur.title) {
      titleChanges.push({ video_id: e.video_id, from: cur.title, to: e.title });
    }
  }
  return { queue, titleChanges, woken: [...woken] };
}

// ---------------------------------------------------------------- SQL

/** Identical shape to the poller's touch_queue write (scripts/rss-poll.ts flush). */
export const TOUCH_QUEUE_SQL = `insert into touch_queue (kind, ref, source_url, mode)
   select 'video', *, 'websub' from unnest($1::text[], $2::text[])
   on conflict (kind, ref) do nothing
   returning 1`;

/** A push is the strongest possible "look now" signal: wake the channel and clear its interval. */
export const WOKEN_SQL = `update channel_rss_state
     set rss_state = 'woken', rss_last_polled = null, rss_backoff_until = null,
         rss_interval_sec = null, updated_at = now()
   where channel_id = any($1) and rss_state is distinct from 'woken'`;

export const PUSH_STAMP_SQL = `update websub_leases set last_push_at = $2, updated_at = now()
   where channel_id = any($1)`;

export const VERIFY_SQL = `insert into websub_leases (channel_id, topic, callback, last_verified_at, lease_expires_at)
   values ($1, $2, $3, $4, $5)
   on conflict (channel_id) do update
     set last_verified_at = excluded.last_verified_at,
         lease_expires_at = coalesce(excluded.lease_expires_at, websub_leases.lease_expires_at),
         callback = excluded.callback,
         topic = excluded.topic,
         failures = 0,
         updated_at = now()`;
