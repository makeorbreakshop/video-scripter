// Subscribe/renew WebSub push subscriptions for every channel in the corpus.
// WebSub is the PRIMARY upload detector; RSS polling is the daily fallback.
// https://developers.google.com/youtube/v3/guides/push_notifications
//
// Usage: WEBSUB_CALLBACK=https://<app>/api/websub npx tsx scripts/websub-subscribe.ts [--all] [--limit N] [--dry]
//   default  renew mode: only channels with no lease, no verification, or expiring within 2 days
//   --all    every channel in channel_rss_state regardless of lease state
//
// ROOT CAUSE OF THE 2026-09-01 RUN (57 accepted / 968 failed): pubsubhubbub.appspot.com
// throttles the source IP and then answers EVERY POST with "503 Transient error; please try
// again later" + Retry-After: 120 (reproduced 2026-09-06 with three different callbacks and
// both verify modes). The old script sent 10-wide bursts 300 ms apart (~33 req/s), had no
// retry for 503, and wrote its per-channel reasons to stderr — which the LaunchAgent did not
// capture. Now: 2.5 req/s, Retry-After-aware retries, and every hub status + body persisted
// to websub_leases.
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

const CALLBACK = process.env.WEBSUB_CALLBACK;
const SECRET = process.env.WEBSUB_SECRET || '';
if (!CALLBACK) { console.error('Set WEBSUB_CALLBACK'); process.exit(1); }

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ALL_SQL = `select channel_id from channel_rss_state order by channel_id limit $1`;
const { rows } = await pool.query(all ? ALL_SQL : DUE_LEASES_SQL, [limit]);
const channels: string[] = rows.map((r: any) => r.channel_id);
log(`${all ? 'subscribing' : 'renewing'} ${channels.length} channels via ${CALLBACK}${SECRET ? ' (signed)' : ''}`);
if (dry || !channels.length) { await pool.end(); process.exit(0); }

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
    log(`  ${(i + 1) * WEBSUB.concurrency > channels.length ? channels.length : (i + 1) * WEBSUB.concurrency}/${channels.length} — ${ok} accepted, ${fail} rejected`);
  }
}
log(`Done. ${ok} accepted, ${fail} failed. (acceptance is not verification: the hub GETs the callback afterwards; watch websub_leases.last_verified_at)`);
await pool.end();
