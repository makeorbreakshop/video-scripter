// Dev-only: GET /dev/preview?token=... sets the preview cookie, then redirects to /app/feed.
import { NextResponse } from 'next/server';
export async function GET(req: Request) {
  const token = process.env.CS_PREVIEW_TOKEN;
  const url = new URL(req.url);
  if (process.env.NODE_ENV === 'production' || !token || url.searchParams.get('token') !== token) return new NextResponse('not found', { status: 404 });
  const res = NextResponse.redirect(new URL(url.searchParams.get('to') || '/app/feed', url.origin));
  res.cookies.set('cs_preview', token, { httpOnly: true, sameSite: 'lax', path: '/' });
  return res;
}
