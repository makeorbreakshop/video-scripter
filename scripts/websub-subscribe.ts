// Subscribe/renew WebSub push subscriptions for every channel in the corpus.
// WebSub is the PRIMARY upload detector; RSS polling is the daily fallback.
// https://developers.google.com/youtube/v3/guides/push_notifications
//
// Usage: WEBSUB_CALLBACK=https://<app>/api/websub npx tsx scripts/websub-subscribe.ts [--all] [--limit N] [--dry]
//   default  renew mode: only channels with no lease, no verification, or expiring within 2 days
//   --all    every channel in channel_rss_state regardless of lease state
//
// ROOT CAUSE OF THE 2026-09-01 RUN (57 accepted / 968 failed), measured 2026-09-06: the hub
// itself accepts only ~8% of subscribe POSTs. The rest stall for exactly 20.2 s and come back
// "503 Transient error; please try again later". Varying concurrency, callback, topic form,
// hub.verify, HTTP version and User-Agent changes nothing (see lib/websub/lease-policy.ts), and
// 57/1,025 is the same 5.6% rate. The old script simply had no way to see or survive that: no
// retry, no lease table, and its per-channel reasons went to stderr, which the LaunchAgent did
// not capture. Now: several passes over whatever is still unaccepted, every hub status and body
// persisted, and the daily LaunchAgent keeps converging.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import {
  WEBSUB, topicUrl, subscribeParams, isHubAccepted, isRetryableHubStatus,
  retryDelayMs, batches, DUE_LEASES_SQL, LEASE_UPSERT_SQL,
} from '../lib/websub/lease-policy';

const args = process.argv.slice(2);
const all = args.includes('--all');
const dry = args.includes('--dry');
const limitArg = args.indexOf('--limit');
const limit = limitArg >= 0 ? parseInt(args[limitArg + 1], 10) : 100_000;
const passArg = args.indexOf('--passes');
const passes = passArg >= 0 ? parseInt(args[passArg + 1], 10) : WEBSUB.passes;

const CALLBACK = process.env.WEBSUB_CALLBACK;
const SECRET = process.env.WEBSUB_SECRET || '';
if (!CALLBACK) { console.error('Set WEBSUB_CALLBACK'); process.exit(1); }

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --all still means "every channel that is not already on a live lease": a verified, unexpired
// lease is exactly what we would be asking the hub to give us again.
const ALL_SQL = `select c.channel_id from channel_rss_state c
     left join websub_leases l on l.channel_id = c.channel_id
    where c.channel_id like 'UC%'
      and (l.channel_id is null or l.last_verified_at is null or l.lease_expires_at <= now())
      -- A 202 is only an acknowledgement; the hub's verification GET follows within minutes.
      -- Don't re-ask inside that window or a multi-pass run just repeats itself.
      and (l.last_hub_status is distinct from 202 or l.last_subscribed_at < now() - interval '1 hour')
    order by c.channel_id limit $1`;

async function select(): Promise<string[]> {
  const { rows } = await pool.query(all ? ALL_SQL : DUE_LEASES_SQL, [limit]);
  return rows.map((r: any) => r.channel_id).filter((c: string) => /^UC[A-Za-z0-9_-]{22}$/.test(c));
}

interface Attempt { channel_id: string; status: number | null; body: string }

async function subscribe(channelId: string): Promise<Attempt> {
  let last: Attempt = { channel_id: channelId, status: null, body: 'no attempt' };
  for (let attempt = 1; attempt <= WEBSUB.maxAttempts; attempt++) {
    try {
      const res = await fetch(WEBSUB.hubUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: subscribeParams({ channelId, callback: CALLBACK!, secret: SECRET }).toString(),
        signal: AbortSignal.timeout(WEBSUB.requestTimeoutMs),
      });
      const body = (await res.text().catch(() => '')).slice(0, 300);
      last = { channel_id: channelId, status: res.status, body };
      if (isHubAccepted(res.status) || !isRetryableHubStatus(res.status)) return last;
      const retryAfter = parseInt(res.headers.get('retry-after') || '0', 10) || null;
      if (attempt < WEBSUB.maxAttempts) await sleep(retryDelayMs(attempt, retryAfter));
    } catch (e) {
      last = { channel_id: channelId, status: null, body: e instanceof Error ? e.message : 'fetch error' };
      if (attempt < WEBSUB.maxAttempts) await sleep(retryDelayMs(attempt, null));
    }
  }
  return last;
}

async function record(attempts: Attempt[]): Promise<void> {
  if (!attempts.length) return;
  const now = new Date();
  await pool.query(LEASE_UPSERT_SQL, [
    attempts.map((a) => a.channel_id),
    attempts.map((a) => topicUrl(a.channel_id)),
    attempts.map(() => CALLBACK),
    attempts.map(() => now),
    attempts.map((a) => a.status),
    attempts.map((a) => a.body),
    attempts.map(() => 0), // seed value; the ON CONFLICT arm decides reset vs increment
  ]);
}

let totalOk = 0;
for (let pass = 1; pass <= passes; pass++) {
  const channels = await select();
  log(`pass ${pass}/${passes}: ${channels.length} channels still without a live lease, via ${CALLBACK}${SECRET ? ' (signed)' : ''}`);
  if (dry || !channels.length) break;
  let ok = 0, fail = 0;
  const groups = batches(channels, WEBSUB.concurrency);
  for (let i = 0; i < groups.length; i++) {
    if (i > 0) await sleep(WEBSUB.batchPauseMs);
    const attempts = await Promise.all(groups[i].map(subscribe));
    for (const a of attempts) {
      if (isHubAccepted(a.status ?? 0)) ok++;
      else { fail++; console.error(`REJECTED ${a.channel_id}: HTTP ${a.status ?? 'network'} ${a.body}`); }
    }
    await record(attempts);
    if (i % 20 === 0 || i === groups.length - 1) {
      log(`  pass ${pass}: ${Math.min((i + 1) * WEBSUB.concurrency, channels.length)}/${channels.length} — ${ok} accepted, ${fail} rejected`);
    }
  }
  totalOk += ok;
  log(`pass ${pass} done: ${ok} accepted, ${fail} rejected (hub acceptance has measured ~8%; that is why there are passes)`);
}
const { rows: live } = await pool.query(
  `select count(*)::int as n from websub_leases where last_verified_at is not null and lease_expires_at > now()`);
log(`Done. ${totalOk} accepted across ${passes} passes; ${live[0].n} channels now hold a verified, unexpired lease.`);
log('(acceptance is not verification: the hub GETs the callback afterwards and the receiver stamps last_verified_at)');
await pool.end();
