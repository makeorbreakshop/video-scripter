// Serves an archived thumbnail version. Local archive (data/thumbnails, written by scripts/thumbnail-watch.ts)
// when present; otherwise the latest version redirects to the YouTube CDN and older versions return 404
// with a header the UI uses to show a "not archived on this host" placeholder.
import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { one } from '@/lib/admin/db';
import { resolveThumbSource, archivePath } from '@/lib/admin/thumb-source';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_: Request, ctx: { params: Promise<{ video: string; version: string }> }) {
  const { video, version } = await ctx.params;
  if (!/^[\w-]{6,20}$/.test(video) || !/^\d{1,4}$/.test(version)) {
    return new NextResponse('bad request', { status: 400 });
  }
  const v = parseInt(version, 10);
  const file = path.join(process.cwd(), archivePath(video, v));
  const fileExists = await fs.stat(file).then((s) => s.isFile()).catch(() => false);
  let latestVersion: number | null = null;
  if (!fileExists) {
    const row = await one<{ v: number }>(`select max(version)::int as v from thumbnail_versions where video_id = $1`, [video]).catch(() => null);
    latestVersion = row?.v ?? null;
  }
  const src = resolveThumbSource({ videoId: video, version: v, latestVersion, fileExists });
  if (src.kind === 'file') {
    const buf = await fs.readFile(file);
    return new NextResponse(buf, {
      headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable', 'x-thumb-source': 'archive' },
    });
  }
  if (src.kind === 'redirect') {
    return NextResponse.redirect(src.url, { status: 302, headers: { 'x-thumb-source': 'cdn' } });
  }
  return new NextResponse('not archived on this host', { status: 404, headers: { 'x-thumb-source': 'missing' } });
}
