// Cache invalidation for callers outside the Next runtime.
//
// The pipeline scripts cannot call revalidateTag (no request context), so they POST here
// and this handler does it for them. Authentication is the shared secret in the header —
// middleware.ts lists this path with the other self-authenticating APIs so Clerk does not
// turn a 401 into a sign-in redirect.
import { NextResponse } from 'next/server';
import { revalidateChannel, revalidateVideo } from '@/lib/app/revalidate';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret || req.headers.get('x-revalidate-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const channels = body.channels ?? [];
  const videos = body.videos ?? [];
  if (!Array.isArray(channels) || !Array.isArray(videos)) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  if (!channels.every((c: unknown) => typeof c === 'string' && c.length > 0)) {
    return NextResponse.json({ error: 'invalid channels' }, { status: 400 });
  }
  if (!videos.every((v: any) => v && typeof v === 'object' && typeof v.id === 'string' && v.id.length > 0)) {
    return NextResponse.json({ error: 'invalid videos' }, { status: 400 });
  }

  for (const id of channels) revalidateChannel(id);
  for (const v of videos) revalidateVideo(v.id, typeof v.channelId === 'string' ? v.channelId : null);

  return NextResponse.json({ ok: true, channels: channels.length, videos: videos.length });
}
