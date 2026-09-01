// Read-only view passthrough for the Chrome extension popup, over direct
// Postgres instead of Supabase REST (2026-08-31 egress rules). Allowlisted
// views only.
import { NextResponse } from 'next/server';
import pg from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let pool: pg.Pool | null = null;
function getPool() {
  if (!pool) pool = new pg.Pool({ connectionString: process.env.DATABASE_POOLER_URL || process.env.DATABASE_URL, max: 2 });
  return pool;
}

const VIEWS = new Set(['ext_stats', 'ext_growth', 'ext_candidates', 'ext_recent']);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: Request) {
  const name = new URL(req.url).searchParams.get('name') ?? '';
  if (!VIEWS.has(name)) {
    return NextResponse.json({ error: 'unknown view' }, { status: 400, headers: CORS });
  }
  try {
    const { rows } = await getPool().query(`select * from ${name} limit 200`);
    return NextResponse.json(rows, { headers: CORS });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'unknown error' },
      { status: 500, headers: CORS }
    );
  }
}
