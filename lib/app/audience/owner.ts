import { one } from '../../admin/db';
import { isOwner } from '../flags';
import { decryptSecret } from '../crypto';

export async function ownerChannel(channelId: string): Promise<{ channelId: string; refreshToken: string }> {
  const row = await one<{ channel_id: string; refresh_token: string; email: string | null; plan: string }>(
    `select yc.channel_id, yc.refresh_token, u.email, u.plan
       from youtube_connections yc join app_users u on u.id = yc.user_id
      where yc.channel_id = $1 order by yc.connected_at limit 1`, [channelId]);
  if (!row || !isOwner(row)) throw new Error('owner channel not found');
  return { channelId: row.channel_id, refreshToken: decryptSecret(row.refresh_token) };
}
