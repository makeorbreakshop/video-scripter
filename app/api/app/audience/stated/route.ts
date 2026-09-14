import { requestOwnerChannel } from '@/lib/app/audience/access';
import { buildProfile, parseStated } from '@/lib/app/audience/profile';

export const maxDuration = 120;

export async function POST(request: Request) {
  const channelId = await requestOwnerChannel();
  if (!channelId) return Response.json({ error: 'not found' }, { status: 404 });
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: 'invalid JSON' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'invalid stated answers' }, { status: 400 });
  try {
    const profile = await buildProfile(channelId, parseStated(body));
    return Response.json({ version: profile.version });
  } catch (error) {
    if (/^(Content bucket|Each content bucket)/.test((error as Error).message)) {
      return Response.json({ error: (error as Error).message }, { status: 400 });
    }
    console.error('audience stated:', error);
    return Response.json({ error: 'audience update failed' }, { status: 500 });
  }
}
