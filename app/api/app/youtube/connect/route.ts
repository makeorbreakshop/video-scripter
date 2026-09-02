// GET /api/app/youtube/connect — start the Google consent flow for a channel the user owns.
// Sets a one-shot state cookie and redirects to Google; /oauth-callback finishes it.
import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { buildAuthUrl, oauthClient, redirectUriFor, OAUTH_STATE_COOKIE } from '@/lib/app/youtube-connect';
import { requireAppUser, unauthorized } from '@/lib/app/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const user = await requireAppUser();
  if (!user) return unauthorized();
  let clientId: string;
  try { clientId = oauthClient().clientId; } catch (e: any) { return Response.json({ error: e.message }, { status: 500 }); }
  const state = randomBytes(24).toString('hex');
  const origin = new URL(req.url).origin;
  const res = NextResponse.redirect(buildAuthUrl({ clientId, redirectUri: redirectUriFor(origin), state }));
  res.cookies.set(OAUTH_STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 600 });
  return res;
}
