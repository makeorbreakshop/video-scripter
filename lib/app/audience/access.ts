import { q } from '../../admin/db';
import { isOwner } from '../flags';
import { requireAppUser } from '../session';

/** Fail closed before any channel data read for app pages and API routes. */
export async function requestOwnerChannel(): Promise<string | null> {
  const user = await requireAppUser();
  if (!user || !isOwner(user)) return null;
  const rows = await q<{ channel_id: string }>(
    `select channel_id from youtube_connections where user_id=$1 order by connected_at limit 1`, [user.id]);
  return rows[0]?.channel_id ?? null;
}
