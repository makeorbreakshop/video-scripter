// Serves an archived thumbnail version from data/thumbnails (local disk, written by scripts/thumbnail-watch.ts).
import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_: Request, ctx: { params: Promise<{ video: string; version: string }> }) {
  const { video, version } = await ctx.params;
  if (!/^[\w-]{6,20}$/.test(video) || !/^\d{1,4}$/.test(version)) {
    return new NextResponse('bad request', { status: 400 });
  }
  const file = path.join(process.cwd(), 'data', 'thumbnails', `${video}_v${version}.jpg`);
  try {
    const buf = await fs.readFile(file);
    return new NextResponse(buf, {
      headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' },
    });
  } catch {
    return new NextResponse('not found', { status: 404 });
  }
}
