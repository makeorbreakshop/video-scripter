import { requestOwnerChannel } from '@/lib/app/audience/access';
import { pullChannelAudience } from '@/lib/app/audience/analytics';
import { fetchAudienceComments } from '@/lib/app/audience/comments';
import { mineComments } from '@/lib/app/audience/extraction';
import { buildThemes, carryThemes } from '@/lib/app/audience/themes';
import { buildProfile, latestProfile } from '@/lib/app/audience/profile';

export const maxDuration = 300;

export async function POST() {
  const channelId = await requestOwnerChannel();
  if (!channelId) return Response.json({ error: 'not found' }, { status: 404 });
  try {
    const analytics = await pullChannelAudience(channelId);
    const comments = await fetchAudienceComments(channelId);
    const mined = await mineComments(channelId);
    const previous = await latestProfile(channelId);
    const themes = mined.comments === 0 && previous
      ? await carryThemes(channelId, Number(previous.version) + 1)
      : await buildThemes(channelId, Number(previous?.version ?? 0) + 1);
    const profile = await buildProfile(channelId);
    return Response.json({ version: profile.version, analytics, comments, mined, themes });
  } catch (error) {
    console.error('audience rebuild:', error);
    return Response.json({ error: 'audience rebuild failed' }, { status: 500 });
  }
}
