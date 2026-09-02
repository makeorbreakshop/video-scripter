// GET /api/v1/search?q= — find channels across the whole library (not only the ones you track).
import { NextResponse } from 'next/server';
import { searchTracked } from '@/lib/app/channels';
import { withApiKey, jsonError, intParam } from '@/lib/api/v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiKey(async (req) => {
  const url = new URL(req.url);
  const qs = (url.searchParams.get('q') || '').trim();
  if (qs.length < 2) return jsonError(400, 'bad_request', 'q must be at least 2 characters.');
  const limit = intParam(url, 'limit', 20, 50);
  const results = await searchTracked(qs, limit);
  return NextResponse.json({ query: qs, channels: results.map((r: any) => ({ id: r.channel_id, name: r.name, video_count: r.video_count, tracked: r.tracked_lane === 'user' })) });
});
