// WebSub (PubSubHubbub) receiver — the primary upload detector.
// https://developers.google.com/youtube/v3/guides/push_notifications
//
// GET  = the hub's verification handshake: echo hub.challenge and record the lease.
// POST = a push: verify the HMAC, parse the Atom entry, and enqueue exactly the way
//        scripts/rss-poll.ts does (touch_queue in 'websub' mode; the drainer imports and the
//        launch tracker enrolls from there). The channel is marked 'woken' so the daily
//        fallback poll looks at it on the next tick.
//
// Replaces server/websub/index.mjs (the Render service): one code path, in this repo.
// Direct Postgres only — never Supabase REST (2026-08-31 egress incident).
import { NextResponse } from 'next/server';
import pg from 'pg';
import {
  verificationResponse, verifySignature, parsePushEntries, pushPlan,
  TOUCH_QUEUE_SQL, WOKEN_SQL, PUSH_STAMP_SQL, VERIFY_SQL, type KnownVideo,
} from '@/lib/websub/receive';
import { topicUrl } from '@/lib/websub/lease-policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let pool: pg.Pool | null = null;
function getPool() {
  if (!pool) pool = new pg.Pool({ connectionString: process.env.DATABASE_POOLER_URL || process.env.DATABASE_URL, max: 2 });
  return pool;
}

const MAX_BODY = 512 * 1024;

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const v = verificationResponse(params);
  if (v.status !== 200) return new NextResponse('not found', { status: 404 });
  // Stamp the verification before answering: the hub treats the 200 as final.
  if (v.channelId) {
    try {
      await getPool().query(VERIFY_SQL, [
        v.channelId, params.get('hub.topic') ?? topicUrl(v.channelId),
        new URL(req.url).origin + '/api/websub', new Date(), v.leaseExpiresAt,
      ]);
    } catch (e) {
      console.error(`websub verify stamp failed for ${v.channelId}: ${(e as Error).message}`);
    }
  }
  return new NextResponse(v.body, { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

export async function POST(req: Request) {
  const body = await req.text();
  if (body.length > MAX_BODY) return new NextResponse(null, { status: 413 });

  const secret = process.env.WEBSUB_SECRET || '';
  if (!verifySignature(body, req.headers.get('x-hub-signature'), secret)) {
    // Acknowledge and ignore: the WebSub spec says a subscriber must not make the hub retry
    // a notification it will never accept.
    console.error('websub: signature mismatch, ignoring push');
    return new NextResponse(null, { status: 204 });
  }

  const entries = parsePushEntries(body);
  if (!entries.length) return new NextResponse(null, { status: 204 });

  const db = getPool();
  const ids = [...new Set(entries.map((e) => e.video_id))];
  try {
    const { rows } = await db.query(`select id, title, published_at from videos where id = any($1)`, [ids]);
    const known = new Map<string, KnownVideo>(rows.map((r: any) => [r.id, { title: r.title, published_at: r.published_at }]));
    const plan = pushPlan(entries, known);

    let queued = 0;
    if (plan.queue.length) {
      const res = await db.query(TOUCH_QUEUE_SQL, [plan.queue.map((q) => q.ref), plan.queue.map((q) => q.source_url)]);
      queued = res.rowCount ?? 0;
    }
    if (plan.woken.length) {
      await db.query(WOKEN_SQL, [plan.woken]);
      await db.query(PUSH_STAMP_SQL, [plan.woken, new Date()]);
    }
    // The title the push carries is diffed by the daily poll's shared title path; log it here so
    // the latency is visible even before that tick runs.
    for (const t of plan.titleChanges) console.log(`websub TITLE ${t.video_id}: "${t.from}" -> "${t.to}"`);
    console.log(
      `websub push ${ids.join(',')} ch=${plan.woken.join(',')} queued=${queued}/${plan.queue.length} ` +
      `published=${entries[0]?.published ?? 'n/a'} received=${new Date().toISOString()}`
    );
  } catch (e) {
    console.error(`websub push write failed: ${(e as Error).message}`);
    return new NextResponse(null, { status: 500 }); // let the hub retry
  }
  return new NextResponse(null, { status: 204 });
}
