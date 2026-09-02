// GET /oauth-callback — Google sends the user back here (the URI registered on the OAuth
// client). Exchanges the code for an offline refresh token, checks which channel the grant
// is for, stores it against the signed-in user, and returns to settings.
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  accessTokenFromRefresh, exchangeCode, ownedChannel, parseCallback, redirectUriFor, saveConnection, OAUTH_STATE_COOKIE,
} from '@/lib/app/youtube-connect';
import { requireAppUser } from '@/lib/app/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (status: string) => NextResponse.redirect(new URL(`/app/settings?youtube=${status}`, url.origin));
  const user = await requireAppUser();
  if (!user) return NextResponse.redirect(new URL('/sign-in', url.origin));

  const jar = await cookies();
  const parsed = parseCallback(url.searchParams, jar.get(OAUTH_STATE_COOKIE)?.value);
  const res = parsed.ok ? null : back(parsed.reason);
  if (res) { res.cookies.delete(OAUTH_STATE_COOKIE); return res; }

  try {
    const tokens = await exchangeCode((parsed as { code: string }).code, redirectUriFor(url.origin));
    const ch = await ownedChannel(tokens.accessToken || await accessTokenFromRefresh(tokens.refreshToken));
    if (!ch) return back('nochannel');
    await saveConnection({ userId: user.id, channelId: ch.id, channelTitle: ch.title, refreshToken: tokens.refreshToken, scopes: tokens.scopes });
    const ok = back('connected');
    ok.cookies.delete(OAUTH_STATE_COOKIE);
    return ok;
  } catch (e: any) {
    console.error('oauth-callback:', e.message);
    return back('failed');
  }
}
