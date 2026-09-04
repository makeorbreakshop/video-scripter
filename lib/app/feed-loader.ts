// What /app/feed needs before it can render, and the pure decisions around it.
//
// The route used to make four sequential Postgres round trips before the first card existed:
// the tracked list, then groups, then memberships, then the feed itself. Three of those four
// are the same per-user shell read and do not depend on each other, so they are one query
// here. On a 500-channel account each avoided round trip is a whole network RTT to Supabase,
// which dominated the actual query time by an order of magnitude.
//
// Direct Postgres only (lib/admin/db.ts) — never supabase-js for bulk reads.
import { one } from '../admin/db';
import type { ChannelGroup } from './channel-groups';
import type { FeedEventLike } from './feed-format';

export interface TrackedChannel { channel_id: string; name: string | null }

export interface FeedShell {
  tracked: TrackedChannel[];
  groups: ChannelGroup[];
  /** channel_id -> group ids. */
  memberships: Record<string, string[]>;
}

/** The tracked channels, the groups and the memberships in one round trip. */
export async function feedShell(userId: string): Promise<FeedShell> {
  const row = await one<{
    tracked: TrackedChannel[] | null;
    groups: ChannelGroup[] | null;
    members: Array<{ channel_id: string; group_id: string }> | null;
  }>(
    `select
       (select coalesce(json_agg(t order by t.name nulls last), '[]'::json)
          from (
            select uc.channel_id, coalesce(cm.title, cs.name) as name
              from user_channels uc
              left join channel_meta cm on cm.channel_id = uc.channel_id
              left join channel_stats cs on cs.channel_id = uc.channel_id
             where uc.user_id = $1
          ) t) as tracked,
       (select coalesce(json_agg(g order by g.position, g.created_at), '[]'::json)
          from (
            select id, name, color, position, created_at
              from channel_groups where user_id = $1
          ) g) as groups,
       (select coalesce(json_agg(m), '[]'::json)
          from (
            select channel_id, group_id from channel_group_members where user_id = $1
          ) m) as members`,
    [userId]
  );
  const memberships: Record<string, string[]> = {};
  for (const m of row?.members || []) (memberships[m.channel_id] ||= []).push(m.group_id);
  return { tracked: row?.tracked || [], groups: row?.groups || [], memberships };
}

export interface FeedSelection {
  /** The channel ids the feed query should read. */
  channelIds: string[];
  /** What the Sort menu shows as selected: a channel id, "group:<id>", or null for all. */
  selected: string | null;
  /** Set when exactly one channel is selected — the client passes it back when paging. */
  channelId: string | null;
}

/**
 * Turn the `channel` URL parameter into the channel set to read.
 *
 * Pure, and deliberately forgiving: a stale group id or a channel the user no longer tracks
 * falls back to the whole tracked set rather than rendering an empty feed. An existing but
 * empty group does the same — an empty `any($1)` would return nothing at all.
 */
export function resolveSelection(
  asked: string | string[] | undefined,
  shell: FeedShell,
): FeedSelection {
  const raw = Array.isArray(asked) ? asked[0] : asked;
  const all = shell.tracked.map((t) => t.channel_id);

  const askedGroup = raw?.startsWith('group:') ? raw.slice(6) : null;
  const groupId = askedGroup && shell.groups.some((g) => g.id === askedGroup) ? askedGroup : null;
  if (groupId) {
    const inGroup = all.filter((id) => (shell.memberships[id] || []).includes(groupId));
    if (inGroup.length) return { channelIds: inGroup, selected: `group:${groupId}`, channelId: null };
    return { channelIds: all, selected: `group:${groupId}`, channelId: null };
  }

  const channelId = raw && !raw.startsWith('group:') && all.includes(raw) ? raw : null;
  if (channelId) return { channelIds: [channelId], selected: channelId, channelId };
  return { channelIds: all, selected: null, channelId: null };
}

/**
 * The channels a rendered page actually needs an avatar for.
 *
 * The route used to read all 500 tracked channels' avatars and ship the whole map to the
 * browser to decorate 60 cards. A page touches a few dozen channels at most, and every later
 * page brings its own map back from /api/app/feed.
 */
export function avatarChannelIds(events: FeedEventLike[]): string[] {
  const ids = new Set<string>();
  for (const e of events || []) if (e.channel_id) ids.add(e.channel_id);
  return [...ids];
}
