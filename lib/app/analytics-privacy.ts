// Ownership boundary for private, owner-only YouTube analytics.
//
// Every row in daily_analytics comes from a creator's own Analytics API grant, so it is
// private to whoever connected that channel. The app connects to Postgres as a role with
// BYPASSRLS, which means row-level security policies would be silently skipped — so the
// enforcement that actually holds is here: there is no way to read this data without
// passing a user id, and every query re-checks the grant in SQL rather than trusting the
// caller. (sql/analytics-privacy.sql adds RLS as defence in depth for the day the app
// connects as a restricted role.)
//
// Direct Postgres only (lib/admin/db.ts) — never supabase-js.
import { q, one } from '../admin/db';

function requireUser(userId: string): void {
  if (!userId || typeof userId !== 'string') throw new Error('a user id is required to read private analytics');
}

/** Does this user hold a live connection for the channel? */
export async function ownsChannel(userId: string, channelId: string): Promise<boolean> {
  requireUser(userId);
  const row = await one<{ x: number }>(
    `select 1 as x from youtube_connections where user_id = $1 and channel_id = $2`,
    [userId, channelId]
  );
  return !!row;
}

export interface PrivateDailyRow {
  video_id: string; date: string; views: number;
  average_view_duration: number; average_view_percentage: number;
  estimated_minutes_watched: number; subscribers_gained: number; subscribers_lost: number;
}

/**
 * Owner analytics for one channel. The ownership check is done twice on purpose: once up
 * front so an unauthorised caller cannot even learn whether rows exist, and once inside the
 * query so a future refactor cannot drop the boundary by editing only one of them.
 */
export async function privateAnalytics(
  userId: string, channelId: string, range: { from?: string; to?: string } = {}
): Promise<PrivateDailyRow[]> {
  requireUser(userId);
  if (!(await ownsChannel(userId, channelId))) return [];
  return q<PrivateDailyRow>(
    `select d.video_id, d.date, d.views, d.average_view_duration, d.average_view_percentage,
            d.estimated_minutes_watched, d.subscribers_gained, d.subscribers_lost
       from daily_analytics d
      where exists (
              select 1 from youtube_connections yc
               where yc.user_id = $1 and yc.channel_id = $2 and yc.channel_id = d.channel_id
            )
        and ($3::date is null or d.date >= $3::date)
        and ($4::date is null or d.date <= $4::date)
      order by d.date, d.video_id`,
    [userId, channelId, range.from ?? null, range.to ?? null]
  );
}

/** The deletion path: disconnecting a channel removes the data it produced. */
export async function deleteChannelData(
  userId: string, channelId: string
): Promise<{ analytics_rows: number; disconnected: boolean }> {
  requireUser(userId);
  if (!(await ownsChannel(userId, channelId))) throw new Error('that channel is not connected by this user');
  const [{ n } = { n: 0 }] = await q<{ n: number }>(
    `with gone as (delete from daily_analytics where channel_id = $1 returning 1)
     select count(*)::int as n from gone`,
    [channelId]
  );
  await q(`delete from youtube_connections where user_id = $1 and channel_id = $2`, [userId, channelId]);
  return { analytics_rows: Number(n ?? 0), disconnected: true };
}

/** Everything for one person, for an account-deletion request. */
export async function forgetUser(userId: string): Promise<{ channels: number; analytics_rows: number }> {
  requireUser(userId);
  const rows = await q<{ channel_id: string }>(`select channel_id from youtube_connections where user_id = $1`, [userId]);
  let analytics = 0;
  for (const r of rows) {
    const out = await deleteChannelData(userId, r.channel_id).catch(() => ({ analytics_rows: 0 }));
    analytics += out.analytics_rows;
  }
  return { channels: rows.length, analytics_rows: analytics };
}
