// GET /api/v1/channels — the calling key's tracked channels.
import { NextResponse } from 'next/server';
import { q } from '@/lib/admin/db';
import { withApiKey } from '@/lib/api/v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiKey(async (_req, caller) => {
  const rows = await q(
    `select uc.channel_id, uc.role, uc.watched_closely, uc.added_at,
            coalesce(m.title, c.channel_name, (select v.channel_name from videos v where v.channel_id = uc.channel_id limit 1)) as channel_name,
            c.channel_handle, coalesce(m.avatar_url, c.thumbnail_url) as thumbnail_url,
            coalesce(m.subscriber_count, c.subscriber_count) as subscriber_count,
            coalesce(m.video_count, c.video_count, (select count(*)::int from videos v where v.channel_id = uc.channel_id)) as video_count
       from user_channels uc
       left join channels c on c.channel_id = uc.channel_id
       left join channel_meta m on m.channel_id = uc.channel_id
      where uc.user_id = $1
      order by uc.added_at desc`,
    [caller.userId]
  );
  return NextResponse.json({
    channels: rows.map((r) => ({
      id: r.channel_id,
      name: r.channel_name ?? null,
      handle: r.channel_handle ?? null,
      thumbnail_url: r.thumbnail_url ?? null,
      subscriber_count: r.subscriber_count ?? null,
      video_count: r.video_count ?? null,
      role: r.role,
      watched_closely: r.watched_closely,
      added_at: r.added_at,
    })),
  });
});
