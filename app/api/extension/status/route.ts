// Status lookups for the Chrome extension's tracked badges.
// Runs over DATABASE_URL (direct Postgres, unmetered) so the extension never
// reads through Supabase REST — see the 2026-08-31 egress incident.
import { NextResponse } from 'next/server';
import pg from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let pool: pg.Pool | null = null;
function getPool() {
  if (!pool) pool = new pg.Pool({ connectionString: process.env.DATABASE_POOLER_URL || process.env.DATABASE_URL, max: 2 });
  return pool;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: Request) {
  try {
    const { ids } = await req.json();
    if (!Array.isArray(ids)) {
      return NextResponse.json({ error: 'ids must be an array' }, { status: 400, headers: CORS });
    }
    const clean = [...new Set(ids)]
      .filter((id): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{6,20}$/.test(id))
      .slice(0, 500);
    if (!clean.length) {
      return NextResponse.json({ tracked: [], queued: [], captured: [] }, { headers: CORS });
    }
    const db = getPool();
    const [vids, queue] = await Promise.all([
      db.query(`select id from videos where id = any($1)`, [clean]),
      db.query(
        `select ref, processed_at from touch_queue where kind = 'video' and ref = any($1)`,
        [clean]
      ),
    ]);
    const tracked = new Set<string>(vids.rows.map((r) => r.id));
    const queued: string[] = [];
    const captured: string[] = [];
    for (const r of queue.rows) {
      if (tracked.has(r.ref)) continue;
      (r.processed_at ? captured : queued).push(r.ref);
    }
    return NextResponse.json({ tracked: [...tracked], queued, captured }, { headers: CORS });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'unknown error' },
      { status: 500, headers: CORS }
    );
  }
}
