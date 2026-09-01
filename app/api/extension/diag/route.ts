// Phone-home diagnostics from the extension content script: when a page has
// known video ids but zero badge targets, the script reports the markup
// fingerprint here so unknown YouTube layouts become test fixtures without
// any manual debugging in the browser.
import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FILE = () => path.join(process.cwd(), 'logs', 'extension-diag.jsonl');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const entry = JSON.stringify({
      at: new Date().toISOString(),
      version: String(body.version ?? ''),
      page: String(body.page ?? '').slice(0, 120),
      idsKnown: Number(body.idsKnown ?? 0),
      fingerprint: String(body.fingerprint ?? '').slice(0, 500),
    });
    await fs.appendFile(FILE(), entry + '\n');
    return NextResponse.json({ ok: true }, { headers: CORS });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'unknown error' },
      { status: 500, headers: CORS }
    );
  }
}

export async function GET() {
  const text = await fs.readFile(FILE(), 'utf8').catch(() => '');
  const lines = text.trim().split('\n').filter(Boolean).slice(-50);
  return NextResponse.json(lines.map((l) => JSON.parse(l)), { headers: CORS });
}
